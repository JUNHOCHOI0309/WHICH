import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import { outboxEvents } from "../../database/schema/index.js";
import type {
  OutboxDeadLetter,
  OutboxDeliveryEvent,
  OutboxPublisherService,
  OutboxTransport,
} from "./contracts.js";

export type OutboxPublisherOptions = {
  batchSize: number;
  leaseMilliseconds: number;
  maxAttempts: number;
  retryBaseMilliseconds: number;
  retryMaxMilliseconds: number;
  now?: () => Date;
};

const MAX_BATCH_SIZE = 500;
const MAX_ERROR_LENGTH = 2_000;

function safeLimit(value: number | undefined, fallback: number) {
  return Math.max(1, Math.min(value ?? fallback, MAX_BATCH_SIZE));
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown Outbox delivery failure.";
  return message.slice(0, MAX_ERROR_LENGTH);
}

function toDeliveryEvent(row: typeof outboxEvents.$inferSelect): OutboxDeliveryEvent {
  if (!row.claimToken) throw new Error("Claimed Outbox Event is missing its lease token.");
  return {
    id: row.id,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    eventType: row.eventType,
    schemaVersion: row.schemaVersion,
    payload: row.payload,
    occurredAt: row.occurredAt,
    attemptCount: row.attemptCount,
    totalAttemptCount: row.totalAttemptCount,
    claimToken: row.claimToken,
  };
}

function toDeadLetter(row: typeof outboxEvents.$inferSelect): OutboxDeadLetter {
  if (!row.deadLetteredAt) throw new Error("Dead Letter is missing deadLetteredAt.");
  return {
    id: row.id,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    eventType: row.eventType,
    schemaVersion: row.schemaVersion,
    occurredAt: row.occurredAt,
    attemptCount: row.attemptCount,
    totalAttemptCount: row.totalAttemptCount,
    requeueCount: row.requeueCount,
    deadLetteredAt: row.deadLetteredAt,
    lastError: row.lastError,
  };
}

export function createOutboxPublisherService(
  database: Database["db"],
  transport: OutboxTransport | null,
  options: OutboxPublisherOptions,
): OutboxPublisherService {
  const now = options.now ?? (() => new Date());

  function retryDelay(attemptCount: number) {
    const exponential = options.retryBaseMilliseconds * 2 ** Math.max(0, attemptCount - 1);
    return Math.min(exponential, options.retryMaxMilliseconds);
  }

  async function markPublished(event: OutboxDeliveryEvent) {
    const [published] = await database
      .update(outboxEvents)
      .set({
        status: "PUBLISHED",
        publishedAt: now(),
        claimToken: null,
        claimedAt: null,
        deadLetteredAt: null,
        lastError: null,
      })
      .where(
        and(
          eq(outboxEvents.id, event.id),
          eq(outboxEvents.status, "PENDING"),
          eq(outboxEvents.claimToken, event.claimToken),
        ),
      )
      .returning({ id: outboxEvents.id });
    return Boolean(published);
  }

  async function markFailed(event: OutboxDeliveryEvent, error: unknown) {
    const failedAt = now();
    const deadLettered = event.attemptCount >= options.maxAttempts;
    const [updated] = await database
      .update(outboxEvents)
      .set({
        status: deadLettered ? "FAILED" : "PENDING",
        availableAt: deadLettered
          ? failedAt
          : new Date(failedAt.getTime() + retryDelay(event.attemptCount)),
        claimToken: null,
        claimedAt: null,
        deadLetteredAt: deadLettered ? failedAt : null,
        lastError: errorMessage(error),
      })
      .where(
        and(
          eq(outboxEvents.id, event.id),
          eq(outboxEvents.status, "PENDING"),
          eq(outboxEvents.claimToken, event.claimToken),
        ),
      )
      .returning({ id: outboxEvents.id });
    return updated ? (deadLettered ? "DEAD_LETTERED" : "RETRIED") : "STALE";
  }

  const service: OutboxPublisherService = {
    async claimBatch(limit) {
      const claimLimit = safeLimit(limit, options.batchSize);
      return database.transaction(async (transaction) => {
        const claimedAt = now();
        const candidates = await transaction
          .select({ id: outboxEvents.id })
          .from(outboxEvents)
          .where(and(eq(outboxEvents.status, "PENDING"), lte(outboxEvents.availableAt, claimedAt)))
          .orderBy(asc(outboxEvents.occurredAt), asc(outboxEvents.id))
          .limit(claimLimit)
          .for("update", { skipLocked: true });

        if (candidates.length === 0) return [];

        const claimToken = randomUUID();
        const leaseExpiresAt = new Date(claimedAt.getTime() + options.leaseMilliseconds);
        const claimed = await transaction
          .update(outboxEvents)
          .set({
            claimToken,
            claimedAt,
            availableAt: leaseExpiresAt,
            attemptCount: sql`${outboxEvents.attemptCount} + 1`,
            totalAttemptCount: sql`${outboxEvents.totalAttemptCount} + 1`,
          })
          .where(
            and(
              inArray(
                outboxEvents.id,
                candidates.map((candidate) => candidate.id),
              ),
              eq(outboxEvents.status, "PENDING"),
              lte(outboxEvents.availableAt, claimedAt),
            ),
          )
          .returning();

        return claimed.map(toDeliveryEvent);
      });
    },

    async processBatch(limit) {
      if (!transport) throw new Error("Outbox Transport is required to publish Events.");
      const claimed = await service.claimBatch(limit);
      const summary = {
        claimed: claimed.length,
        published: 0,
        retried: 0,
        deadLettered: 0,
        staleClaims: 0,
      };

      await Promise.all(
        claimed.map(async (event) => {
          try {
            await transport.deliver(event);
            if (await markPublished(event)) summary.published += 1;
            else summary.staleClaims += 1;
          } catch (error) {
            const outcome = await markFailed(event, error);
            if (outcome === "RETRIED") summary.retried += 1;
            else if (outcome === "DEAD_LETTERED") summary.deadLettered += 1;
            else summary.staleClaims += 1;
          }
        }),
      );

      return summary;
    },

    async listDeadLetters(limit) {
      const rows = await database
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.status, "FAILED"))
        .orderBy(desc(outboxEvents.deadLetteredAt), desc(outboxEvents.occurredAt))
        .limit(safeLimit(limit, options.batchSize));
      return rows.map(toDeadLetter);
    },

    async requeueDeadLetter(eventId) {
      const requeuedAt = now();
      const [row] = await database
        .update(outboxEvents)
        .set({
          status: "PENDING",
          attemptCount: 0,
          requeueCount: sql`${outboxEvents.requeueCount} + 1`,
          availableAt: requeuedAt,
          claimToken: null,
          claimedAt: null,
          publishedAt: null,
          deadLetteredAt: null,
          lastError: null,
        })
        .where(and(eq(outboxEvents.id, eventId), eq(outboxEvents.status, "FAILED")))
        .returning();

      if (!row) return null;
      return {
        id: row.id,
        status: "PENDING" as const,
        attemptCount: row.attemptCount,
        totalAttemptCount: row.totalAttemptCount,
        requeueCount: row.requeueCount,
        availableAt: row.availableAt,
      };
    },
  };

  return service;
}
