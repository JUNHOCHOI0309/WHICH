import { createHmac, randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Database } from "../src/database/client.js";
import { outboxEvents } from "../src/database/schema/index.js";
import type { OutboxTransport } from "../src/modules/outbox/contracts.js";
import { getOutboxWorkerConfig } from "../src/modules/outbox/config.js";
import { createHttpOutboxTransport } from "../src/modules/outbox/http-transport.js";
import { createOutboxPublisherService } from "../src/modules/outbox/service.js";
import { createTestDatabase } from "./helpers/test-database.js";

let database: Database;
let dropDatabase: () => Promise<void>;

const baseOptions = {
  batchSize: 50,
  leaseMilliseconds: 30_000,
  maxAttempts: 2,
  retryBaseMilliseconds: 1_000,
  retryMaxMilliseconds: 10_000,
};

async function insertEvent(availableAt: Date, eventType = "TEST_EVENT") {
  const id = randomUUID();
  const payload = {
    event_id: id,
    event_type: eventType,
    schema_version: 1,
    occurred_at: availableAt.toISOString(),
    aggregate_type: "TEST",
    aggregate_id: `test:${id}`,
    data: { value: 1 },
  };
  await database.db.insert(outboxEvents).values({
    id,
    aggregateType: "TEST",
    aggregateId: `test:${id}`,
    eventType,
    schemaVersion: 1,
    payload,
    occurredAt: availableAt,
    availableAt,
  });
  return { id, payload };
}

beforeAll(async () => {
  const testDatabase = await createTestDatabase();
  database = testDatabase.database;
  dropDatabase = () => testDatabase.drop();
}, 30_000);

afterAll(async () => {
  await database.close();
  await dropDatabase();
});

describe("Outbox Publisher", () => {
  it("claims one Event only once while another Worker is delivering it", async () => {
    const currentTime = new Date("2026-08-19T00:00:00.000Z");
    const event = await insertEvent(currentTime, "CONCURRENT_EVENT");
    let releaseDelivery: (() => void) | undefined;
    let notifyDeliveryStarted: (() => void) | undefined;
    const deliveryStarted = new Promise<void>((resolve) => {
      notifyDeliveryStarted = resolve;
    });
    const deliveryReleased = new Promise<void>((resolve) => {
      releaseDelivery = resolve;
    });
    const transport: OutboxTransport = {
      async deliver() {
        notifyDeliveryStarted?.();
        await deliveryReleased;
      },
    };
    const workerA = createOutboxPublisherService(database.db, transport, {
      ...baseOptions,
      now: () => currentTime,
    });
    const workerB = createOutboxPublisherService(database.db, transport, {
      ...baseOptions,
      now: () => currentTime,
    });

    const firstRun = workerA.processBatch(1);
    await deliveryStarted;
    const competingRun = await workerB.processBatch(1);

    expect(competingRun).toEqual({
      claimed: 0,
      published: 0,
      retried: 0,
      deadLettered: 0,
      staleClaims: 0,
    });
    releaseDelivery?.();
    expect(await firstRun).toMatchObject({ claimed: 1, published: 1 });

    const [stored] = await database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, event.id));
    expect(stored).toMatchObject({
      status: "PUBLISHED",
      attemptCount: 1,
      totalAttemptCount: 1,
      claimToken: null,
      claimedAt: null,
    });
    expect(stored?.publishedAt).toEqual(currentTime);
  });

  it("recovers an expired lease after a Worker stops before delivery", async () => {
    let currentTime = new Date("2026-08-19T01:00:00.000Z");
    const event = await insertEvent(currentTime, "LEASE_RECOVERY_EVENT");
    const crashedWorker = createOutboxPublisherService(database.db, null, {
      ...baseOptions,
      now: () => currentTime,
    });
    const firstClaim = await crashedWorker.claimBatch(1);
    expect(firstClaim).toHaveLength(1);

    currentTime = new Date(currentTime.getTime() + baseOptions.leaseMilliseconds + 1);
    const deliveredIds: string[] = [];
    const recoveryWorker = createOutboxPublisherService(
      database.db,
      {
        deliver(claimed) {
          deliveredIds.push(claimed.id);
          return Promise.resolve();
        },
      },
      { ...baseOptions, now: () => currentTime },
    );
    const recovered = await recoveryWorker.processBatch(1);

    expect(recovered).toMatchObject({ claimed: 1, published: 1 });
    expect(deliveredIds).toEqual([event.id]);
    const [stored] = await database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, event.id));
    expect(stored).toMatchObject({
      status: "PUBLISHED",
      attemptCount: 2,
      totalAttemptCount: 2,
    });
  });

  it("backs off, moves to Dead Letter, and preserves lifetime attempts after requeue", async () => {
    let currentTime = new Date("2026-08-19T02:00:00.000Z");
    const event = await insertEvent(currentTime, "RETRY_EVENT");
    let shouldFail = true;
    const transport: OutboxTransport = {
      deliver() {
        return shouldFail
          ? Promise.reject(new Error("Temporary downstream failure without secrets."))
          : Promise.resolve();
      },
    };
    const publisher = createOutboxPublisherService(database.db, transport, {
      ...baseOptions,
      now: () => currentTime,
    });

    expect(await publisher.processBatch(1)).toMatchObject({ claimed: 1, retried: 1 });
    let [stored] = await database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, event.id));
    expect(stored).toMatchObject({
      status: "PENDING",
      attemptCount: 1,
      totalAttemptCount: 1,
      lastError: "Temporary downstream failure without secrets.",
    });
    expect(stored?.availableAt).toEqual(new Date(currentTime.getTime() + 1_000));

    currentTime = new Date(currentTime.getTime() + 1_001);
    expect(await publisher.processBatch(1)).toMatchObject({ claimed: 1, deadLettered: 1 });
    [stored] = await database.db.select().from(outboxEvents).where(eq(outboxEvents.id, event.id));
    expect(stored).toMatchObject({
      status: "FAILED",
      attemptCount: 2,
      totalAttemptCount: 2,
      requeueCount: 0,
    });
    expect(stored?.deadLetteredAt).toEqual(currentTime);
    expect(await publisher.listDeadLetters()).toEqual([
      expect.objectContaining({ id: event.id, attemptCount: 2, totalAttemptCount: 2 }),
    ]);

    const requeued = await publisher.requeueDeadLetter(event.id);
    expect(requeued).toMatchObject({
      id: event.id,
      status: "PENDING",
      attemptCount: 0,
      totalAttemptCount: 2,
      requeueCount: 1,
    });

    shouldFail = false;
    expect(await publisher.processBatch(1)).toMatchObject({ claimed: 1, published: 1 });
    [stored] = await database.db.select().from(outboxEvents).where(eq(outboxEvents.id, event.id));
    expect(stored).toMatchObject({
      status: "PUBLISHED",
      attemptCount: 1,
      totalAttemptCount: 3,
      requeueCount: 1,
      lastError: null,
      deadLetteredAt: null,
    });
  });
});

describe("HTTP Outbox Transport", () => {
  it("sends the stable Event payload with idempotency headers and an HMAC signature", async () => {
    const secret = "test-outbox-secret-at-least-16-characters";
    const payload = { event_id: randomUUID(), event_type: "SIGNED_EVENT", data: { value: 7 } };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204, statusText: "No Content" }));
    const transport = createHttpOutboxTransport({
      url: "https://events.example.com/which",
      secret,
      timeoutMilliseconds: 1_000,
      fetch: fetchMock,
    });

    await transport.deliver({
      id: payload.event_id,
      aggregateType: "TEST",
      aggregateId: "test:1",
      eventType: "SIGNED_EVENT",
      schemaVersion: 1,
      payload,
      occurredAt: new Date("2026-08-19T03:00:00.000Z"),
      attemptCount: 1,
      totalAttemptCount: 3,
      claimToken: randomUUID(),
    });

    const body = JSON.stringify(payload);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://events.example.com/which");
    expect(request).toMatchObject({ method: "POST", body });
    const headers = new Headers(request?.headers);
    expect(headers.get("x-which-event-id")).toBe(payload.event_id);
    expect(headers.get("x-which-event-type")).toBe("SIGNED_EVENT");
    expect(headers.get("x-which-schema-version")).toBe("1");
    expect(headers.get("x-which-delivery-attempt")).toBe("3");
    expect(headers.get("x-which-signature")).toBe(
      `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
    );
  });
});

describe("Outbox Worker configuration", () => {
  it("rejects a retry cap below its base delay", () => {
    expect(() =>
      getOutboxWorkerConfig({ OUTBOX_RETRY_BASE_MS: "10000", OUTBOX_RETRY_MAX_MS: "5000" }, false),
    ).toThrow("OUTBOX_RETRY_MAX_MS must be greater than or equal");
  });

  it("requires the lease to outlive the HTTP timeout", () => {
    expect(() =>
      getOutboxWorkerConfig({ OUTBOX_LEASE_MS: "5000", OUTBOX_HTTP_TIMEOUT_MS: "5000" }, false),
    ).toThrow("OUTBOX_LEASE_MS must be greater than OUTBOX_HTTP_TIMEOUT_MS");
  });
});
