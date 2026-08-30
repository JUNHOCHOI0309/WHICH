import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../database/client.js";
import {
  issueMediaAssets,
  issueMediaKnownBlockHashes,
  memberCapabilityGrants,
  memberMediaConsents,
  members,
  memberIssueSubmissions,
  moderationRuns,
  moderationTargets,
  policyJudgeBudgets,
  policyJudgeEvaluations,
} from "../../database/schema/index.js";
import {
  MODERATION_POLICY_VERSION,
  type ModerationShadowAdapter,
} from "../moderation-dispatch/contracts.js";
import type { ModerationProviderInput } from "../moderation-providers/contracts.js";
import type { ModerationProviderRuntimeConfig } from "../moderation-providers/runtime-gate.js";
import { embeddedTextEvidenceSchema } from "../issue-media/embedded-text.js";
import { createLunaJudgeAdapter, prepareJudgeRequest } from "./adapter.js";
import {
  judgeCosts,
  judgeDiagnostic,
  POLICY_JUDGE_CONSENT_VERSION,
  POLICY_JUDGE_PROFILE,
  sampleBucket,
  type PolicyJudgeConfig,
} from "./contracts.js";
import { createJudgeLedger } from "./ledger.js";

const safetySchema = z.object({
  provider: z.literal("OPENAI_MODERATION"),
  inputScope: z.literal("SUBMISSION_REVISION"),
  imageCount: z.literal(2),
  abstained: z.literal(false),
  modelSnapshot: z.string(),
  embeddedText: embeddedTextEvidenceSchema,
  signals: z.array(z.object({ flagged: z.boolean(), rawScore: z.number().min(0).max(1) })).min(1),
});

export function createPolicyJudgeService(options: {
  database: Database["db"];
  config: PolicyJudgeConfig;
  provider: ModerationProviderRuntimeConfig;
  resolveInput: (
    input: Parameters<ModerationShadowAdapter["inspect"]>[0],
  ) => Promise<ModerationProviderInput>;
  call?: ReturnType<typeof createLunaJudgeAdapter>;
  now?: () => Date;
}) {
  const { database, config, provider } = options;
  const now = options.now ?? (() => new Date());
  const ledger = createJudgeLedger(database, config, now);
  const call =
    options.call ??
    createLunaJudgeAdapter({
      apiKey: provider.OPENAI_API_KEY ?? "",
      timeoutMs: config.MODERATION_POLICY_JUDGE_TIMEOUT_MS,
    });

  async function circuitOpen() {
    const current = now();
    const [recent] = await database
      .select({
        calls: sql<number>`count(*)::int`,
        failures: sql<number>`count(*) filter (where ${policyJudgeEvaluations.status} in ('FAILED', 'UNKNOWN'))::int`,
        authenticationFailures: sql<number>`count(*) filter (where ${policyJudgeEvaluations.reason} = 'AUTHENTICATION')::int`,
      })
      .from(policyJudgeEvaluations)
      .where(
        and(
          sql`${policyJudgeEvaluations.createdAt} >= ${new Date(current.getTime() - 5 * 60_000)}`,
          sql`${policyJudgeEvaluations.createdAt} <= ${current}`,
          sql`${policyJudgeEvaluations.reservedMicros} > 0`,
        ),
      );
    return Boolean(
      recent &&
      (recent.authenticationFailures > 0 ||
        (recent.calls >= 5 && recent.failures * 2 >= recent.calls)),
    );
  }

  async function readSource(
    sourceRunId: string,
    reader = database,
    lock = false,
  ): Promise<{
    run: typeof moderationRuns.$inferSelect;
    target: typeof moderationTargets.$inferSelect;
    submission: typeof memberIssueSubmissions.$inferSelect;
  } | null> {
    const [row] = await reader
      .select({
        run: moderationRuns,
        target: moderationTargets,
        submission: memberIssueSubmissions,
      })
      .from(moderationRuns)
      .innerJoin(moderationTargets, eq(moderationTargets.id, moderationRuns.targetId))
      .innerJoin(memberIssueSubmissions, eq(memberIssueSubmissions.id, moderationTargets.targetId))
      .where(eq(moderationRuns.id, sourceRunId))
      .limit(1);
    if (!row) return null;
    if (lock) {
      await reader.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`which:member-issue-submission:${row.submission.id}`}, 0))`,
      );
      await reader
        .select({ id: memberIssueSubmissions.id })
        .from(memberIssueSubmissions)
        .where(eq(memberIssueSubmissions.id, row.submission.id))
        .for("update");
      const ids = [row.submission.mediaAssetAId, row.submission.mediaAssetBId].filter(
        (v): v is string => Boolean(v),
      );
      if (ids.length)
        await reader
          .select({ id: issueMediaAssets.id })
          .from(issueMediaAssets)
          .where(inArray(issueMediaAssets.id, ids))
          .orderBy(asc(issueMediaAssets.id))
          .for("update");
      return readSource(sourceRunId, reader);
    }
    const { run, target, submission } = row;
    const [access] = await reader
      .select({ id: members.id })
      .from(members)
      .innerJoin(
        memberMediaConsents,
        and(
          eq(memberMediaConsents.memberId, members.id),
          eq(memberMediaConsents.consentVersion, POLICY_JUDGE_CONSENT_VERSION),
          isNull(memberMediaConsents.revokedAt),
        ),
      )
      .innerJoin(
        memberCapabilityGrants,
        and(
          eq(memberCapabilityGrants.memberId, members.id),
          eq(memberCapabilityGrants.capabilityCode, "ISSUE_IMAGE_UPLOAD"),
          eq(memberCapabilityGrants.state, "ACTIVE"),
          sql`${memberCapabilityGrants.expiresAt} > ${now()}`,
        ),
      )
      .where(and(eq(members.id, submission.memberId), eq(members.status, "ACTIVE")))
      .limit(1);
    if (!access) return null;
    if (
      run.status !== "SUCCEEDED" ||
      run.mode !== "SHADOW" ||
      run.modelProvider !== "OPENAI_MODERATION" ||
      run.policyVersion !== MODERATION_POLICY_VERSION ||
      target.targetType !== "ISSUE_VERSION" ||
      target.snapshotReference !==
        `issue-submission://revision/${submission.id}/${submission.revision}` ||
      submission.revision !== target.targetVersion ||
      submission.contentHash !== run.normalizedInputHash ||
      target.inputHash !== run.normalizedInputHash ||
      !["PENDING", "NEEDS_CHANGES"].includes(submission.status) ||
      submission.publishedIssueId
    )
      return null;
    const ids = [submission.mediaAssetAId, submission.mediaAssetBId];
    if (!ids[0] || !ids[1] || ids[0] === ids[1]) return null;
    const assets = await reader
      .select()
      .from(issueMediaAssets)
      .where(inArray(issueMediaAssets.id, ids as string[]));
    if (
      assets.length !== 2 ||
      assets.some(
        (a) =>
          a.uploadedByMemberId !== submission.memberId ||
          a.sourceType !== "MEMBER_SUBMISSION" ||
          a.processingState !== "READY" ||
          !["STAGED", "PUBLISHED"].includes(a.storageState) ||
          !["PENDING", "APPROVED"].includes(a.moderationState) ||
          !["ASSERTED", "CLEARED"].includes(a.rightsState),
      )
    )
      return null;
    const [blocked] = await reader
      .select({ hash: issueMediaKnownBlockHashes.sha256 })
      .from(issueMediaKnownBlockHashes)
      .where(
        and(
          inArray(
            issueMediaKnownBlockHashes.sha256,
            assets.map((a) => a.sha256),
          ),
          eq(issueMediaKnownBlockHashes.active, true),
        ),
      )
      .limit(1);
    if (blocked) return null;
    return row;
  }

  async function process(sourceRunId: string) {
    const gate = judgeDiagnostic(config, provider);
    if (!gate.allowed) return { status: "DISABLED", reason: gate.reason };
    if (await circuitOpen()) return { status: "DEFERRED", reason: "PROVIDER_CIRCUIT_OPEN" };
    const row = await readSource(sourceRunId);
    if (!row) return ledger.skip(sourceRunId, "TARGET_UNAVAILABLE");
    const safety = safetySchema.safeParse(row.run.result);
    if (!safety.success || safety.data.modelSnapshot !== provider.OPENAI_MODERATION_MODEL)
      return ledger.skip(sourceRunId, "SAFETY_EVIDENCE_REQUIRED");
    if (safety.data.signals.some((s) => s.flagged))
      return ledger.skip(sourceRunId, "SAFETY_REVIEW_REQUIRED");
    if (safety.data.embeddedText.images.some((i) => i.status !== "COMPLETE"))
      return ledger.skip(sourceRunId, "LOCAL_EVIDENCE_INCOMPLETE");
    if (
      sampleBucket(row.run.normalizedInputHash, POLICY_JUDGE_PROFILE) >=
      config.MODERATION_POLICY_JUDGE_CANARY_PERCENT
    )
      return ledger.skip(sourceRunId, "OUTSIDE_CANARY");
    // Without a calibrated visual router, low safety scores are not sufficient to skip
    // context review. Canary controls SHADOW spend, never eligibility for publication.
    const reason = safety.data.signals.some((s) => s.rawScore >= 0.1)
      ? "SAFETY_UNCERTAIN"
      : sampleBucket(row.run.normalizedInputHash, "low-signal-audit") <
          config.MODERATION_POLICY_JUDGE_AUDIT_PERCENT
        ? "LOW_SIGNAL_AUDIT"
        : "COVERAGE_GAP";
    let prepared;
    try {
      const input = await options.resolveInput({
        targetType: "ISSUE_VERSION",
        targetId: row.submission.id,
        targetVersion: row.target.targetVersion,
        privateObjectReference: row.target.snapshotReference,
        normalizedInputHash: row.run.normalizedInputHash,
        policyVersion: row.run.policyVersion,
      });
      prepared = await prepareJudgeRequest(input, row.run.policyVersion);
    } catch {
      return ledger.skip(sourceRunId, "INPUT_UNAVAILABLE");
    }
    if (!(await readSource(sourceRunId))) return ledger.skip(sourceRunId, "TARGET_CHANGED");
    const reservation = await ledger.reserve({
      sourceRunId,
      cacheKey: prepared.cacheKey,
      policyVersion: row.run.policyVersion,
      reservedMicros: prepared.reservedMicros,
      reason,
      isCurrent: async (tx) => Boolean(await readSource(sourceRunId, tx, true)),
    });
    if (reservation.status !== "RESERVED") return reservation;
    // Call once only. A network exception may still have been billed; retain the reservation.
    const result = await call(prepared).catch(() => ({
      decision: null,
      usage: null,
      reason: "REQUEST_OUTCOME_UNKNOWN",
      latencyMs: 0,
    }));
    const costs = result.usage ? judgeCosts(result.usage) : undefined;
    const status = !result.usage
      ? "UNKNOWN"
      : !result.decision
        ? "FAILED"
        : result.decision.decision === "ABSTAIN"
          ? "ABSTAINED"
          : "SUCCEEDED";
    const finished = await ledger.finish({
      id: reservation.job.id,
      status,
      reason: result.reason,
      result: result.decision
        ? { decision: result.decision, model: gate.model, profile: POLICY_JUDGE_PROFILE }
        : {},
      ...costs,
      inputTokens: result.usage?.input_tokens,
      outputTokens: result.usage?.output_tokens,
      latencyMs: result.latencyMs,
      policyVersion: row.run.policyVersion,
      isCurrent: async (tx) => Boolean(await readSource(sourceRunId, tx, true)),
    });
    return { status: finished, reason: result.reason };
  }

  async function runBatch(limit = 10) {
    const gate = judgeDiagnostic(config, provider);
    if (!gate.allowed) return { gate, processed: [] };
    await ledger.reconcileUnknown();
    const rows = await database
      .select({ id: moderationRuns.id })
      .from(moderationRuns)
      .innerJoin(moderationTargets, eq(moderationTargets.id, moderationRuns.targetId))
      .innerJoin(
        memberIssueSubmissions,
        and(
          eq(memberIssueSubmissions.id, moderationTargets.targetId),
          eq(memberIssueSubmissions.revision, moderationTargets.targetVersion),
        ),
      )
      .leftJoin(
        policyJudgeEvaluations,
        and(
          eq(policyJudgeEvaluations.sourceRunId, moderationRuns.id),
          eq(policyJudgeEvaluations.profile, POLICY_JUDGE_PROFILE),
        ),
      )
      .where(
        and(
          eq(moderationRuns.status, "SUCCEEDED"),
          eq(moderationRuns.modelProvider, "OPENAI_MODERATION"),
          eq(moderationTargets.targetType, "ISSUE_VERSION"),
          inArray(memberIssueSubmissions.status, ["PENDING", "NEEDS_CHANGES"]),
          sql`${memberIssueSubmissions.mediaAssetAId} is not null`,
          isNull(policyJudgeEvaluations.id),
        ),
      )
      .orderBy(asc(moderationRuns.completedAt))
      .limit(Math.min(50, Math.max(1, limit)));
    const processed = [];
    for (const row of rows) {
      const result = await process(row.id);
      processed.push({ sourceRunId: row.id, ...result });
      if (["DAILY_BUDGET_EXHAUSTED", "PROVIDER_CIRCUIT_OPEN"].includes(result.reason)) break;
    }
    return { gate, processed };
  }

  async function summary() {
    const day = now().toISOString().slice(0, 10);
    const [budget] = await database
      .select()
      .from(policyJudgeBudgets)
      .where(eq(policyJudgeBudgets.day, day));
    const totals = await database
      .select({
        status: policyJudgeEvaluations.status,
        count: sql<number>`count(*)::int`,
        estimatedCostMicros: sql<number>`coalesce(sum(${policyJudgeEvaluations.costMicros}), 0)::bigint`,
      })
      .from(policyJudgeEvaluations)
      .where(sql`${policyJudgeEvaluations.createdAt} >= ${new Date(`${day}T00:00:00Z`)}`)
      .groupBy(policyJudgeEvaluations.status);
    return {
      ...judgeDiagnostic(config, provider),
      day,
      budget: budget ?? { calls: 0, committedMicros: 0 },
      totals,
      costIsEstimate: true,
      circuitOpen: await circuitOpen(),
    };
  }
  return { process, runBatch, summary };
}
