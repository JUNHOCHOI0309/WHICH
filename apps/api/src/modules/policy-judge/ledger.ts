import { and, eq, gt, sql } from "drizzle-orm";
import type { Database } from "../../database/client.js";
import {
  moderationProviderCallCache,
  policyJudgeBudgets,
  policyJudgeEvaluations,
} from "../../database/schema/index.js";
import {
  judgeDecisionSchema,
  POLICY_JUDGE_CACHE_TTL_MS,
  POLICY_JUDGE_MODEL,
  POLICY_JUDGE_PROFILE,
  POLICY_JUDGE_PROVIDER,
  type PolicyJudgeConfig,
} from "./contracts.js";

export function createJudgeLedger(
  database: Database["db"],
  config: PolicyJudgeConfig,
  now = () => new Date(),
) {
  async function skip(sourceRunId: string, reason: string) {
    await database
      .insert(policyJudgeEvaluations)
      .values({
        sourceRunId,
        profile: POLICY_JUDGE_PROFILE,
        status: "SKIPPED",
        reason,
        completedAt: now(),
      })
      .onConflictDoNothing();
    return { status: "SKIPPED", reason };
  }
  async function reserve(input: {
    sourceRunId: string;
    cacheKey: string;
    policyVersion: string;
    reservedMicros: number;
    reason: string;
    isCurrent: (tx: Database["db"]) => Promise<boolean>;
  }) {
    if (!Number.isSafeInteger(input.reservedMicros) || input.reservedMicros < 1)
      throw new Error("INVALID_JUDGE_RESERVATION");
    return database.transaction(async (tx) => {
      // Cross-process deduplication. Never hold a transaction open over the network request.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`which:policy-judge:${input.cacheKey}`}, 0))`,
      );
      const [existing] = await tx
        .select()
        .from(policyJudgeEvaluations)
        .where(
          and(
            eq(policyJudgeEvaluations.sourceRunId, input.sourceRunId),
            eq(policyJudgeEvaluations.profile, POLICY_JUDGE_PROFILE),
          ),
        );
      if (existing) return { status: "EXISTING" as const, reason: existing.status };
      if (!(await input.isCurrent(tx as unknown as Database["db"])))
        return { status: "STALE" as const, reason: "TARGET_CHANGED" };
      const [cached] = await tx
        .select()
        .from(moderationProviderCallCache)
        .where(
          and(
            eq(moderationProviderCallCache.provider, POLICY_JUDGE_PROVIDER),
            eq(moderationProviderCallCache.modelName, POLICY_JUDGE_MODEL),
            eq(moderationProviderCallCache.modelVersion, POLICY_JUDGE_PROFILE),
            eq(moderationProviderCallCache.policyVersion, input.policyVersion),
            eq(moderationProviderCallCache.normalizedInputHash, input.cacheKey),
            eq(moderationProviderCallCache.status, "SUCCEEDED"),
            gt(moderationProviderCallCache.expiresAt, now()),
          ),
        )
        .limit(1);
      const validCache = judgeDecisionSchema.safeParse(cached?.result.decision);
      if (cached && validCache.success && validCache.data.decision !== "ABSTAIN") {
        await tx.insert(policyJudgeEvaluations).values({
          sourceRunId: input.sourceRunId,
          profile: POLICY_JUDGE_PROFILE,
          cacheKey: input.cacheKey,
          status: "CACHE_HIT",
          reason: input.reason,
          completedAt: now(),
          costMicros: 0,
          result: { decision: validCache.data, shadow: true, publicationChanged: false },
        });
        return { status: "CACHE_HIT" as const, reason: input.reason };
      }
      const [inFlight] = await tx
        .select({ id: policyJudgeEvaluations.id })
        .from(policyJudgeEvaluations)
        .where(
          and(
            eq(policyJudgeEvaluations.cacheKey, input.cacheKey),
            eq(policyJudgeEvaluations.status, "RUNNING"),
          ),
        )
        .limit(1);
      if (inFlight) return { status: "DEFERRED" as const, reason: "DUPLICATE_IN_FLIGHT" };
      const day = now().toISOString().slice(0, 10);
      await tx.insert(policyJudgeBudgets).values({ day }).onConflictDoNothing();
      const [budget] = await tx
        .update(policyJudgeBudgets)
        .set({
          calls: sql`${policyJudgeBudgets.calls} + 1`,
          committedMicros: sql`${policyJudgeBudgets.committedMicros} + ${input.reservedMicros}`,
        })
        .where(
          and(
            eq(policyJudgeBudgets.day, day),
            sql`${policyJudgeBudgets.calls} < ${config.MODERATION_POLICY_JUDGE_DAILY_CALL_CAP}`,
            sql`${policyJudgeBudgets.committedMicros} + ${input.reservedMicros} <= ${config.MODERATION_POLICY_JUDGE_DAILY_COST_MICROS_CAP}`,
          ),
        )
        .returning();
      if (!budget) return { status: "DEFERRED" as const, reason: "DAILY_BUDGET_EXHAUSTED" };
      const [job] = await tx
        .insert(policyJudgeEvaluations)
        .values({
          sourceRunId: input.sourceRunId,
          profile: POLICY_JUDGE_PROFILE,
          cacheKey: input.cacheKey,
          status: "RUNNING",
          reason: input.reason,
          budgetDay: day,
          reservedMicros: input.reservedMicros,
          chargedMicros: input.reservedMicros,
          createdAt: now(),
        })
        .returning();
      return { status: "RESERVED" as const, job: job! };
    });
  }
  async function finish(input: {
    id: string;
    status: "SUCCEEDED" | "ABSTAINED" | "FAILED" | "UNKNOWN" | "STALE";
    reason: string;
    result: Record<string, unknown>;
    chargedMicros?: number;
    costMicros?: number;
    inputTokens?: number;
    outputTokens?: number;
    latencyMs: number;
    policyVersion: string;
    // Read and lock current content in the same transaction as accepting evidence/cache.
    isCurrent: (tx: Database["db"]) => Promise<boolean>;
  }) {
    return database.transaction(async (tx) => {
      const [job] = await tx
        .select()
        .from(policyJudgeEvaluations)
        .where(eq(policyJudgeEvaluations.id, input.id))
        .for("update");
      if (!job || job.status !== "RUNNING") return "ALREADY_FINISHED";
      const current = await input.isCurrent(tx as unknown as Database["db"]);
      const status = current ? input.status : "STALE";
      const charged = input.chargedMicros ?? job.reservedMicros;
      if (!Number.isSafeInteger(charged) || charged < 0)
        throw new Error("INVALID_JUDGE_SETTLEMENT");
      // Charges belong to the day of reservation, including requests crossing midnight.
      await tx
        .update(policyJudgeBudgets)
        .set({
          committedMicros: sql`${policyJudgeBudgets.committedMicros} + ${charged - job.chargedMicros}`,
        })
        .where(eq(policyJudgeBudgets.day, job.budgetDay!));
      const result = current
        ? { ...input.result, shadow: true, publicationChanged: false }
        : { shadow: true, publicationChanged: false };
      await tx
        .update(policyJudgeEvaluations)
        .set({
          status,
          reason: current ? input.reason : "TARGET_CHANGED",
          result,
          chargedMicros: charged,
          costMicros: input.costMicros,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          latencyMs: input.latencyMs,
          completedAt: now(),
        })
        .where(eq(policyJudgeEvaluations.id, job.id));
      if (status === "SUCCEEDED") {
        await tx
          .insert(moderationProviderCallCache)
          .values({
            provider: POLICY_JUDGE_PROVIDER,
            modelName: POLICY_JUDGE_MODEL,
            modelVersion: POLICY_JUDGE_PROFILE,
            policyVersion: input.policyVersion,
            normalizedInputHash: job.cacheKey!,
            status: "SUCCEEDED",
            result,
            latencyMs: input.latencyMs,
            costMicros: input.costMicros ?? 0,
            expiresAt: new Date(now().getTime() + POLICY_JUDGE_CACHE_TTL_MS),
            createdAt: now(),
          })
          .onConflictDoUpdate({
            target: [
              moderationProviderCallCache.provider,
              moderationProviderCallCache.modelName,
              moderationProviderCallCache.modelVersion,
              moderationProviderCallCache.policyVersion,
              moderationProviderCallCache.normalizedInputHash,
            ],
            set: {
              result,
              expiresAt: new Date(now().getTime() + POLICY_JUDGE_CACHE_TTL_MS),
              createdAt: now(),
            },
          });
      }
      return status;
    });
  }
  // A worker crash must not leave an eternal in-flight lock or refund potentially billed calls.
  async function reconcileUnknown() {
    return database
      .update(policyJudgeEvaluations)
      .set({ status: "UNKNOWN", reason: "WORKER_OUTCOME_UNKNOWN", completedAt: now() })
      .where(
        and(
          eq(policyJudgeEvaluations.status, "RUNNING"),
          sql`${policyJudgeEvaluations.createdAt} < ${new Date(now().getTime() - 5 * 60_000)}`,
        ),
      )
      .returning({ id: policyJudgeEvaluations.id });
  }
  return { skip, reserve, finish, reconcileUnknown };
}
