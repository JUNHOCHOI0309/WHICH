import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "../../database/client.js";
import {
  radarIngestionRuns,
  radarProviderRequests,
  radarQuotaDailyUsage,
  radarRunQuotaUsage,
} from "../../database/schema/radar-ingestion.js";
import { radarSourceSchema } from "./contracts.js";
import {
  evaluateRadarAccess,
  evaluateRadarRequest,
  radarActivationSchema,
  radarBudgetDayKey,
  type RadarActivation,
} from "./source-policy.js";
import { RADAR_POLICY_VERSION, radarSourceRegistry } from "./source-registry.js";

const timestamp = z.iso.datetime({ offset: true });
const identifier = z.string().trim().min(1).max(200);
const safeKey = z.string().regex(/^[0-9a-zA-Z:_-]{1,128}$/);
const failureCodeSchema = z.enum([
  "RATE_LIMIT",
  "TIMEOUT",
  "AUTH",
  "UPSTREAM",
  "INVALID_RESPONSE",
  "BUDGET_EXHAUSTED",
  "POLICY_DENIED",
  "LEASE_EXPIRED",
]);
export type RadarFailureCode = z.infer<typeof failureCodeSchema>;

const dispatchSchema = z.strictObject({
  dispatchKey: safeKey,
  source: radarSourceSchema,
  operation: identifier,
  sampledAt: timestamp,
  maxAttempts: z.number().int().min(1).max(20),
});

export const radarCompletionSchema = z
  .strictObject({
    status: z.enum(["SUCCEEDED", "EMPTY_VALID", "PARTIAL"]),
    pageCount: z.number().int().nonnegative().max(100_000),
    observationCount: z.number().int().nonnegative().max(10_000_000),
    truncated: z.boolean(),
    // Human-readable coverage descriptors only. Never put cursor/token values here.
    missingCoverage: z.array(z.string().trim().min(1).max(200)).max(100),
    failureCode: failureCodeSchema.nullable(),
  })
  .superRefine((result, context) => {
    const invalid = (message: string) => context.addIssue({ code: "custom", message });
    if (
      result.status === "SUCCEEDED" &&
      (result.pageCount === 0 ||
        result.observationCount === 0 ||
        result.failureCode ||
        result.truncated ||
        result.missingCoverage.length)
    ) {
      invalid("Success requires observations and complete pagination coverage");
    }
    if (
      result.status === "EMPTY_VALID" &&
      (result.pageCount === 0 ||
        result.observationCount ||
        result.failureCode ||
        result.truncated ||
        result.missingCoverage.length)
    ) {
      invalid("A valid empty result must have complete coverage without failure");
    }
    if (
      result.status === "PARTIAL" &&
      (result.pageCount === 0 ||
        result.observationCount === 0 ||
        !result.failureCode ||
        (!result.truncated && result.missingCoverage.length === 0))
    ) {
      invalid("Partial results must record a failure and missing pagination coverage");
    }
  });
export type RadarCompletion = z.infer<typeof radarCompletionSchema>;

export type RadarRunClaim = {
  id: string;
  source: z.infer<typeof radarSourceSchema>;
  operation: string;
  quotaScopeId: string;
  policyVersion: string;
  sampledAt: Date;
  attemptCount: number;
  maxAttempts: number;
  claimToken: string;
  leaseExpiresAt: Date;
};

export class RadarIngestionFailure extends Error {
  constructor(
    public readonly failureCode: RadarFailureCode,
    public readonly retryable: boolean,
    public readonly httpStatus: number | null = null,
    public readonly retryAfterMilliseconds: number | null = null,
  ) {
    super(`Radar provider failure: ${failureCode}`);
  }
}

export class RadarBudgetFailure extends RadarIngestionFailure {
  constructor(public readonly reason: string) {
    super("BUDGET_EXHAUSTED", false);
  }
}

export function classifyRadarHttpFailure(
  status: number,
  retryAfterMilliseconds: number | null = null,
) {
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    return new RadarIngestionFailure("INVALID_RESPONSE", false);
  }
  if (status === 429) {
    return new RadarIngestionFailure("RATE_LIMIT", true, status, retryAfterMilliseconds);
  }
  if (status === 408 || status === 504) {
    return new RadarIngestionFailure("TIMEOUT", true, status, retryAfterMilliseconds);
  }
  if (status >= 500) {
    return new RadarIngestionFailure("UPSTREAM", true, status, retryAfterMilliseconds);
  }
  if (status === 401 || status === 403) {
    return new RadarIngestionFailure("AUTH", false, status);
  }
  return new RadarIngestionFailure("INVALID_RESPONSE", false, status);
}

type ServiceOptions = {
  leaseMilliseconds: number;
  timeoutMilliseconds: number;
  retryBaseMilliseconds: number;
  retryMaxMilliseconds: number;
  now?: () => Date;
};

type CollectorContext = {
  signal: AbortSignal;
  request<T>(
    operation: string,
    requestKey: string,
    perform: (signal: AbortSignal) => Promise<T>,
  ): Promise<T>;
};

function validateOptions(options: ServiceOptions) {
  for (const [name, value] of Object.entries(options).filter(([name]) => name !== "now")) {
    if (!Number.isInteger(value) || (value as number) < 1) throw new Error(`${name} is invalid`);
  }
  if (options.leaseMilliseconds <= options.timeoutMilliseconds) {
    throw new Error("Radar lease must outlive the collection timeout");
  }
  if (options.retryMaxMilliseconds < options.retryBaseMilliseconds) {
    throw new Error("Radar retry maximum must be at least the base delay");
  }
}

function toClaim(row: typeof radarIngestionRuns.$inferSelect): RadarRunClaim {
  if (!row.claimToken || !row.leaseExpiresAt) throw new Error("RADAR_RUN_NOT_CLAIMED");
  return {
    id: row.id,
    source: radarSourceSchema.parse(row.source),
    operation: row.operation,
    quotaScopeId: row.quotaScopeId,
    policyVersion: row.policyVersion,
    sampledAt: row.sampledAt,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    claimToken: row.claimToken,
    leaseExpiresAt: row.leaseExpiresAt,
  };
}

function normalizedFailure(error: unknown): RadarIngestionFailure {
  if (error instanceof RadarIngestionFailure) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new RadarIngestionFailure("TIMEOUT", true);
  }
  return new RadarIngestionFailure("UPSTREAM", true);
}

export function createRadarIngestionService(database: Database["db"], options: ServiceOptions) {
  validateOptions(options);
  const now = options.now ?? (() => new Date());

  function validateActivation(
    claimOrDispatch: { source: string; quotaScopeId?: string; policyVersion?: string },
    input: unknown,
  ) {
    let activation: RadarActivation;
    try {
      activation = radarActivationSchema.parse(input);
    } catch {
      throw new RadarIngestionFailure("POLICY_DENIED", false);
    }
    if (
      activation.source !== claimOrDispatch.source ||
      (claimOrDispatch.quotaScopeId && activation.quotaScopeId !== claimOrDispatch.quotaScopeId) ||
      (claimOrDispatch.policyVersion &&
        activation.policyVersion !== claimOrDispatch.policyVersion) ||
      activation.policyVersion !== RADAR_POLICY_VERSION
    ) {
      throw new RadarIngestionFailure("POLICY_DENIED", false);
    }
    const access = evaluateRadarAccess(activation, ["collect", "store"], now().toISOString());
    if (!access.allowed) throw new RadarIngestionFailure("POLICY_DENIED", false);
    return activation;
  }

  function retryDelay(attemptCount: number, retryAfter: number | null) {
    const exponential = Math.min(
      options.retryBaseMilliseconds * 2 ** Math.max(0, attemptCount - 1),
      options.retryMaxMilliseconds,
    );
    // Honor provider Retry-After up to one day; this is not the exponential cap.
    const providerDelay = retryAfter !== null && Number.isFinite(retryAfter) ? retryAfter : 0;
    return Math.max(exponential, Math.min(Math.max(providerDelay, 0), 86_400_000));
  }

  async function assertLiveClaim(
    transaction: Parameters<Parameters<typeof database.transaction>[0]>[0],
    claim: RadarRunClaim,
    at: Date,
  ) {
    const [run] = await transaction
      .select()
      .from(radarIngestionRuns)
      .where(eq(radarIngestionRuns.id, claim.id))
      .for("update");
    if (
      !run ||
      run.status !== "RUNNING" ||
      run.claimToken !== claim.claimToken ||
      !run.leaseExpiresAt ||
      run.leaseExpiresAt <= at
    ) {
      throw new RadarIngestionFailure("LEASE_EXPIRED", false);
    }
    return run;
  }

  async function reserveProviderRequest(
    claim: RadarRunClaim,
    activation: RadarActivation,
    operation: string,
    requestKey: string,
  ) {
    identifier.parse(operation);
    safeKey.parse(requestKey);
    activation = validateActivation(claim, activation);
    const at = now();
    return database.transaction(async (transaction) => {
      const run = await assertLiveClaim(transaction, claim, at);
      if (
        activation.source !== run.source ||
        activation.quotaScopeId !== run.quotaScopeId ||
        activation.policyVersion !== run.policyVersion
      ) {
        throw new RadarIngestionFailure("POLICY_DENIED", false);
      }
      const [existing] = await transaction
        .select()
        .from(radarProviderRequests)
        .where(
          and(
            eq(radarProviderRequests.runId, run.id),
            eq(radarProviderRequests.requestKey, requestKey),
          ),
        );
      if (existing) {
        if (existing.operation !== operation) throw new Error("RADAR_REQUEST_KEY_CONFLICT");
        return { ...existing, duplicate: true as const };
      }

      const limits = radarSourceRegistry[activation.source].operations[operation];
      if (!limits) throw new RadarBudgetFailure("OPERATION_UNREGISTERED");
      const dayKey = radarBudgetDayKey(at.toISOString(), limits.timeZone);
      await transaction
        .insert(radarQuotaDailyUsage)
        .values({
          policyVersion: activation.policyVersion,
          source: activation.source,
          quotaScopeId: activation.quotaScopeId,
          pool: limits.pool,
          dayKey,
        })
        .onConflictDoNothing();
      const [daily] = await transaction
        .select()
        .from(radarQuotaDailyUsage)
        .where(
          and(
            eq(radarQuotaDailyUsage.policyVersion, activation.policyVersion),
            eq(radarQuotaDailyUsage.source, activation.source),
            eq(radarQuotaDailyUsage.quotaScopeId, activation.quotaScopeId),
            eq(radarQuotaDailyUsage.pool, limits.pool),
            eq(radarQuotaDailyUsage.dayKey, dayKey),
          ),
        )
        .for("update");
      await transaction
        .insert(radarRunQuotaUsage)
        .values({ runId: run.id, pool: limits.pool })
        .onConflictDoNothing();
      const [runUsage] = await transaction
        .select()
        .from(radarRunQuotaUsage)
        .where(and(eq(radarRunQuotaUsage.runId, run.id), eq(radarRunQuotaUsage.pool, limits.pool)))
        .for("update");
      if (!daily || !runUsage) throw new Error("RADAR_BUDGET_LEDGER_MISSING");
      const decision = evaluateRadarRequest(
        activation,
        { source: activation.source, operation, runId: run.id },
        {
          policyVersion: activation.policyVersion,
          source: activation.source,
          quotaScopeId: activation.quotaScopeId,
          pool: limits.pool,
          runId: run.id,
          dayKey,
          runRequests: runUsage.requestCount,
          dayRequests: daily.requestCount,
          runUnits: runUsage.unitCount,
          dayUnits: daily.unitCount,
        },
        at.toISOString(),
      );
      if (!decision.allowed) throw new RadarBudgetFailure(decision.reason);
      await transaction
        .update(radarQuotaDailyUsage)
        .set({
          requestCount: sql`${radarQuotaDailyUsage.requestCount} + 1`,
          unitCount: sql`${radarQuotaDailyUsage.unitCount} + ${limits.unitCost}`,
          updatedAt: at,
        })
        .where(
          and(
            eq(radarQuotaDailyUsage.policyVersion, activation.policyVersion),
            eq(radarQuotaDailyUsage.source, activation.source),
            eq(radarQuotaDailyUsage.quotaScopeId, activation.quotaScopeId),
            eq(radarQuotaDailyUsage.pool, limits.pool),
            eq(radarQuotaDailyUsage.dayKey, dayKey),
          ),
        );
      await transaction
        .update(radarRunQuotaUsage)
        .set({
          requestCount: sql`${radarRunQuotaUsage.requestCount} + 1`,
          unitCount: sql`${radarRunQuotaUsage.unitCount} + ${limits.unitCost}`,
          updatedAt: at,
        })
        .where(and(eq(radarRunQuotaUsage.runId, run.id), eq(radarRunQuotaUsage.pool, limits.pool)));
      const [reserved] = await transaction
        .insert(radarProviderRequests)
        .values({
          runId: run.id,
          requestKey,
          operation,
          pool: limits.pool,
          unitCost: limits.unitCost,
          reservedAt: at,
        })
        .returning();
      if (!reserved) throw new Error("RADAR_REQUEST_RESERVATION_FAILED");
      return { ...reserved, duplicate: false as const };
    });
  }

  async function finishProviderRequest(
    claim: RadarRunClaim,
    requestId: string,
    outcome: { status: "SUCCEEDED" } | { status: "FAILED"; failure: RadarIngestionFailure },
  ) {
    const at = now();
    return database.transaction(async (transaction) => {
      await assertLiveClaim(transaction, claim, at);
      const [updated] = await transaction
        .update(radarProviderRequests)
        .set(
          outcome.status === "SUCCEEDED"
            ? {
                status: "SUCCEEDED",
                retryable: false,
                completedAt: at,
              }
            : {
                status: "FAILED",
                httpStatus: outcome.failure.httpStatus,
                failureCode: outcome.failure.failureCode,
                retryable: outcome.failure.retryable,
                completedAt: at,
              },
        )
        .where(
          and(
            eq(radarProviderRequests.id, requestId),
            eq(radarProviderRequests.runId, claim.id),
            eq(radarProviderRequests.status, "RESERVED"),
          ),
        )
        .returning({ id: radarProviderRequests.id });
      return Boolean(updated);
    });
  }

  async function markRunFailure(claim: RadarRunClaim, failure: RadarIngestionFailure) {
    const at = now();
    const retry = failure.retryable && claim.attemptCount < claim.maxAttempts;
    return database.transaction(async (transaction) => {
      const [updated] = await transaction
        .update(radarIngestionRuns)
        .set({
          status: retry ? "PENDING" : "FAILED",
          availableAt: retry
            ? new Date(
                at.getTime() + retryDelay(claim.attemptCount, failure.retryAfterMilliseconds),
              )
            : at,
          claimToken: null,
          claimedAt: null,
          leaseExpiresAt: null,
          failureCode: failure.failureCode,
          // Never persist provider bodies, URLs, credentials or thrown error strings.
          lastError: `Provider attempt failed (${failure.failureCode}).`,
          completedAt: retry ? null : at,
          updatedAt: at,
        })
        .where(
          and(
            eq(radarIngestionRuns.id, claim.id),
            eq(radarIngestionRuns.status, "RUNNING"),
            eq(radarIngestionRuns.claimToken, claim.claimToken),
            sql`${radarIngestionRuns.leaseExpiresAt} > ${at}`,
          ),
        )
        .returning({ id: radarIngestionRuns.id });
      if (updated) {
        await transaction
          .update(radarProviderRequests)
          .set({
            status: "FAILED",
            failureCode: failure.failureCode,
            retryable: failure.retryable,
            completedAt: at,
          })
          .where(
            and(
              eq(radarProviderRequests.runId, claim.id),
              eq(radarProviderRequests.status, "RESERVED"),
            ),
          );
      }
      return updated ? (retry ? "RETRY_SCHEDULED" : "FAILED") : "STALE_CLAIM";
    });
  }

  async function completeRun(claim: RadarRunClaim, input: unknown) {
    const result = radarCompletionSchema.parse(input);
    const at = now();
    return database.transaction(async (transaction) => {
      await assertLiveClaim(transaction, claim, at);
      const [requestCounts] = await transaction
        .select({
          reserved: sql<number>`count(*) filter (where ${radarProviderRequests.status} = 'RESERVED')::int`,
          failed: sql<number>`count(*) filter (where ${radarProviderRequests.status} = 'FAILED')::int`,
        })
        .from(radarProviderRequests)
        .where(eq(radarProviderRequests.runId, claim.id));
      if (!requestCounts || requestCounts.reserved !== 0) {
        throw new Error("RADAR_PROVIDER_REQUESTS_STILL_RESERVED");
      }
      if (requestCounts.failed !== 0 && result.status !== "PARTIAL") {
        throw new Error("RADAR_FAILED_REQUEST_REQUIRES_PARTIAL_RESULT");
      }
      const [updated] = await transaction
        .update(radarIngestionRuns)
        .set({
          status: result.status,
          pageCount: result.pageCount,
          observationCount: result.observationCount,
          truncated: result.truncated,
          missingCoverage: result.missingCoverage,
          failureCode: result.failureCode,
          lastError: null,
          claimToken: null,
          claimedAt: null,
          leaseExpiresAt: null,
          completedAt: at,
          updatedAt: at,
        })
        .where(
          and(
            eq(radarIngestionRuns.id, claim.id),
            eq(radarIngestionRuns.status, "RUNNING"),
            eq(radarIngestionRuns.claimToken, claim.claimToken),
            sql`${radarIngestionRuns.leaseExpiresAt} > ${at}`,
          ),
        )
        .returning();
      return updated ?? null;
    });
  }

  const service = {
    async dispatch(input: unknown, activationInput: unknown) {
      const command = dispatchSchema.parse(input);
      const activation = validateActivation({ source: command.source }, activationInput);
      if (
        activation.policyVersion !== RADAR_POLICY_VERSION ||
        !radarSourceRegistry[command.source].operations[command.operation]
      ) {
        throw new RadarIngestionFailure("POLICY_DENIED", false);
      }
      const at = now();
      await database
        .insert(radarIngestionRuns)
        .values({
          dispatchKey: command.dispatchKey,
          source: command.source,
          operation: command.operation,
          quotaScopeId: activation.quotaScopeId,
          policyVersion: activation.policyVersion,
          sampledAt: new Date(command.sampledAt),
          availableAt: at,
          maxAttempts: command.maxAttempts,
        })
        .onConflictDoNothing({ target: radarIngestionRuns.dispatchKey });
      const [run] = await database
        .select()
        .from(radarIngestionRuns)
        .where(eq(radarIngestionRuns.dispatchKey, command.dispatchKey));
      if (
        !run ||
        run.source !== command.source ||
        run.operation !== command.operation ||
        run.quotaScopeId !== activation.quotaScopeId ||
        run.policyVersion !== activation.policyVersion ||
        run.sampledAt.toISOString() !== new Date(command.sampledAt).toISOString() ||
        run.maxAttempts !== command.maxAttempts
      ) {
        throw new Error("RADAR_DISPATCH_KEY_CONFLICT");
      }
      return run;
    },

    async claimNext() {
      return database.transaction(async (transaction) => {
        const at = now();
        const exhausted = await transaction
          .select({ id: radarIngestionRuns.id })
          .from(radarIngestionRuns)
          .where(
            and(
              eq(radarIngestionRuns.status, "RUNNING"),
              lte(radarIngestionRuns.leaseExpiresAt, at),
              sql`${radarIngestionRuns.attemptCount} >= ${radarIngestionRuns.maxAttempts}`,
            ),
          )
          .for("update", { skipLocked: true });
        const exhaustedIds = exhausted.map(({ id }) => id);
        if (exhaustedIds.length > 0) {
          await transaction
            .update(radarProviderRequests)
            .set({
              status: "FAILED",
              failureCode: "LEASE_EXPIRED",
              retryable: false,
              completedAt: at,
            })
            .where(
              and(
                inArray(radarProviderRequests.runId, exhaustedIds),
                eq(radarProviderRequests.status, "RESERVED"),
              ),
            );
          await transaction
            .update(radarIngestionRuns)
            .set({
              status: "FAILED",
              failureCode: "LEASE_EXPIRED",
              lastError: "Run exhausted attempts after its lease expired.",
              claimToken: null,
              claimedAt: null,
              leaseExpiresAt: null,
              completedAt: at,
              updatedAt: at,
            })
            .where(inArray(radarIngestionRuns.id, exhaustedIds));
        }
        const [candidate] = await transaction
          .select({ id: radarIngestionRuns.id, status: radarIngestionRuns.status })
          .from(radarIngestionRuns)
          .where(
            and(
              sql`${radarIngestionRuns.attemptCount} < ${radarIngestionRuns.maxAttempts}`,
              or(
                and(
                  eq(radarIngestionRuns.status, "PENDING"),
                  lte(radarIngestionRuns.availableAt, at),
                ),
                and(
                  eq(radarIngestionRuns.status, "RUNNING"),
                  lte(radarIngestionRuns.leaseExpiresAt, at),
                ),
              ),
            ),
          )
          .orderBy(asc(radarIngestionRuns.availableAt), asc(radarIngestionRuns.createdAt))
          .limit(1)
          .for("update", { skipLocked: true });
        if (!candidate) return null;
        if (candidate.status === "RUNNING") {
          await transaction
            .update(radarProviderRequests)
            .set({
              status: "FAILED",
              failureCode: "LEASE_EXPIRED",
              retryable: true,
              completedAt: at,
            })
            .where(
              and(
                eq(radarProviderRequests.runId, candidate.id),
                eq(radarProviderRequests.status, "RESERVED"),
              ),
            );
        }
        const claimToken = randomUUID();
        const [claimed] = await transaction
          .update(radarIngestionRuns)
          .set({
            status: "RUNNING",
            claimToken,
            claimedAt: at,
            leaseExpiresAt: new Date(at.getTime() + options.leaseMilliseconds),
            attemptCount: sql`${radarIngestionRuns.attemptCount} + 1`,
            startedAt: sql`coalesce(${radarIngestionRuns.startedAt}, ${at})`,
            failureCode: null,
            lastError: null,
            updatedAt: at,
          })
          .where(eq(radarIngestionRuns.id, candidate.id))
          .returning();
        return claimed ? toClaim(claimed) : null;
      });
    },

    async renewLease(claim: RadarRunClaim) {
      const at = now();
      const [updated] = await database
        .update(radarIngestionRuns)
        .set({
          leaseExpiresAt: new Date(at.getTime() + options.leaseMilliseconds),
          updatedAt: at,
        })
        .where(
          and(
            eq(radarIngestionRuns.id, claim.id),
            eq(radarIngestionRuns.status, "RUNNING"),
            eq(radarIngestionRuns.claimToken, claim.claimToken),
            sql`${radarIngestionRuns.leaseExpiresAt} > ${at}`,
          ),
        )
        .returning({ leaseExpiresAt: radarIngestionRuns.leaseExpiresAt });
      return updated?.leaseExpiresAt ?? null;
    },

    async processClaim(
      claim: RadarRunClaim,
      activationInput: unknown,
      collect: (context: CollectorContext) => Promise<RadarCompletion>,
    ) {
      let activation: RadarActivation;
      try {
        activation = validateActivation(claim, activationInput);
      } catch (error) {
        return markRunFailure(claim, normalizedFailure(error));
      }
      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const timeoutFailure = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new RadarIngestionFailure("TIMEOUT", true));
        }, options.timeoutMilliseconds);
      });
      const context: CollectorContext = {
        signal: controller.signal,
        async request(operation, requestKey, perform) {
          const reservation = await reserveProviderRequest(
            claim,
            activation,
            operation,
            requestKey,
          );
          if (reservation.duplicate) {
            throw new Error("RADAR_REQUEST_KEY_ALREADY_USED");
          }
          try {
            const value = await perform(controller.signal);
            const finished = await finishProviderRequest(claim, reservation.id, {
              status: "SUCCEEDED",
            });
            if (!finished) throw new Error("RADAR_PROVIDER_REQUEST_NOT_RESERVED");
            return value;
          } catch (error) {
            const failure = normalizedFailure(error);
            await finishProviderRequest(claim, reservation.id, { status: "FAILED", failure });
            throw failure;
          }
        },
      };
      try {
        const completion = await Promise.race([collect(context), timeoutFailure]);
        return (await completeRun(claim, completion)) ? completion.status : "STALE_CLAIM";
      } catch (error) {
        return markRunFailure(claim, normalizedFailure(error));
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    },

    reserveProviderRequest,
    finishProviderRequest,
    completeRun,
    markRunFailure,

    async getRun(runId: string) {
      z.uuid().parse(runId);
      const [run] = await database
        .select()
        .from(radarIngestionRuns)
        .where(eq(radarIngestionRuns.id, runId));
      return run ?? null;
    },
  };

  return service;
}

export type RadarIngestionService = ReturnType<typeof createRadarIngestionService>;
