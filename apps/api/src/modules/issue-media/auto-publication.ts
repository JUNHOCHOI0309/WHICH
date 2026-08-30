import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../database/client.js";
import {
  issueMediaAssets,
  issueMediaAssetVersions,
  issueMediaKnownBlockHashes,
  memberIssueSubmissions,
  members,
  memberMediaConsents,
  memberCapabilityGrants,
  moderationRuns,
  moderationTargets,
  moderationAuditEvents,
  moderationReconciliations,
  policyJudgeEvaluations,
} from "../../database/schema/index.js";
import type { InterestCardCode } from "../interests/contracts.js";
import { normalizeCommand, publishReviewedSubmission } from "../issues/creation-service.js";
import {
  MODERATION_PROVIDER_INPUT_VERSION,
  type ModerationProviderInput,
} from "../moderation-providers/contracts.js";
import { normalizedResultSchema } from "../moderation-providers/image-shadow-findings.js";
import { openAiCoverage } from "../moderation-providers/openai-coverage.js";
import { embeddedTextEvidenceSchema } from "./embedded-text.js";
import type { IssueMediaObjectStorage } from "./contracts.js";
import { prepareJudgeRequest } from "../policy-judge/adapter.js";
import {
  judgeDecisionSchema,
  POLICY_JUDGE_PROFILE,
  POLICY_JUDGE_CACHE_TTL_MS,
} from "../policy-judge/contracts.js";
import type { createPolicyJudgeService } from "../policy-judge/service.js";

export const AUTO_PUBLICATION_POLICY = "which-auto-publication-pilot-v1";
const PUBLIC_REPAIR = `${AUTO_PUBLICATION_POLICY}:public`;
const PRIVATE_REPAIR = `${AUTO_PUBLICATION_POLICY}:private`;
const environmentSchema = z.object({
  ISSUE_MEDIA_AUTO_PUBLICATION_MODE: z.enum(["OFF", "PILOT"]).default("OFF"),
  ISSUE_MEDIA_AUTO_PUBLICATION_MEMBER_IDS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.uuid()).max(20)),
  ISSUE_MEDIA_AUTO_PUBLICATION_KILL_SWITCH: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});
export function autoPublicationConfig(env: NodeJS.ProcessEnv = process.env) {
  return environmentSchema.parse(env);
}
export type AutoPublicationConfig = ReturnType<typeof autoPublicationConfig>;

const safetySchema = normalizedResultSchema.extend({
  provider: z.literal("OPENAI_MODERATION"),
  modality: z.literal("TEXT_AND_IMAGE"),
  inputScope: z.literal("SUBMISSION_REVISION"),
  imageCount: z.literal(2),
  embeddedText: embeddedTextEvidenceSchema,
  inputBinding: z.object({
    contractVersion: z.literal(MODERATION_PROVIDER_INPUT_VERSION),
    targetType: z.literal("ISSUE_VERSION"),
    targetVersion: z.number().int(),
    inputHash: z.string(),
  }),
});

// This is a bounded pilot policy, not a claim of calibration or complete model coverage.
// Scores are routing signals, not probabilities. Uncertainty always retains private review.
export function clearPublicationEvidence(input: {
  result: unknown;
  decision: unknown;
  model: string;
  revision: number;
  hash: string;
  imageHashes: string[];
}) {
  const safety = safetySchema.safeParse(input.result);
  const judge = judgeDecisionSchema.safeParse(input.decision);
  if (!safety.success || !judge.success) return false;
  const s = safety.data;
  const d = judge.data;
  const coverage = openAiCoverage(s.signals);
  return (
    s.modelSnapshot === input.model &&
    !s.abstained &&
    s.providerDisagreement !== true &&
    s.inputBinding.targetVersion === input.revision &&
    s.inputBinding.inputHash === input.hash &&
    coverage.missingImageLabels.length === 0 &&
    coverage.missingTextLabels.length === 0 &&
    s.signals.every((v) => !v.flagged && v.calibratedBand === "LOW" && v.rawScore < 0.1) &&
    input.imageHashes.length === 2 &&
    s.embeddedText.images.length === 2 &&
    s.embeddedText.images.every(
      (v, i) => v.status === "COMPLETE" && v.normalizedHash === input.imageHashes[i],
    ) &&
    d.decision === "ALLOW" &&
    !d.needs_human &&
    d.reason_codes.length === 1 &&
    d.reason_codes[0] === "NONE" &&
    d.image_relevance === "RELATED" &&
    d.pair_fairness === "BALANCED" &&
    d.privacy_risk === "LOW" &&
    d.rights_risk === "LOW"
  );
}

type Judge = ReturnType<typeof createPolicyJudgeService>;
type Source = NonNullable<Awaited<ReturnType<Judge["readCurrentSource"]>>>;
type Reader = Parameters<Judge["readCurrentSource"]>[1];
export function createAutoPublicationService(options: {
  database: Database["db"];
  storage: IssueMediaObjectStorage | null;
  config: AutoPublicationConfig;
  judge: Pick<Judge, "readCurrentSource">;
  safetyModel: string;
  runtimeAllowed: () => boolean;
  resolveInput: (input: {
    targetType: "ISSUE_VERSION";
    targetId: string;
    targetVersion: number;
    normalizedInputHash: string;
    privateObjectReference: string;
    policyVersion: string;
  }) => Promise<ModerationProviderInput>;
  now?: () => Date;
}) {
  const { database, storage, config, judge } = options;
  const now = options.now ?? (() => new Date());
  const enabled = () =>
    config.ISSUE_MEDIA_AUTO_PUBLICATION_MODE === "PILOT" &&
    !config.ISSUE_MEDIA_AUTO_PUBLICATION_KILL_SWITCH &&
    config.ISSUE_MEDIA_AUTO_PUBLICATION_MEMBER_IDS.length > 0 &&
    typeof storage?.preparePublication === "function" &&
    typeof storage.exists === "function" &&
    options.runtimeAllowed();
  const lockSubmission = (tx: NonNullable<Reader>, id: string) =>
    tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`which:member-issue-submission:${id}`}, 0))`,
    );

  async function evidence(id: string, reader: Reader = database, lock = false) {
    const [evaluation] = await reader
      .select()
      .from(policyJudgeEvaluations)
      .where(eq(policyJudgeEvaluations.id, id));
    if (
      !evaluation ||
      !["SUCCEEDED", "CACHE_HIT"].includes(evaluation.status) ||
      evaluation.profile !== POLICY_JUDGE_PROFILE ||
      !evaluation.completedAt ||
      evaluation.completedAt > now() ||
      now().getTime() - evaluation.completedAt.getTime() > POLICY_JUDGE_CACHE_TTL_MS
    )
      return null;
    const source = await judge.readCurrentSource(evaluation.sourceRunId, reader, lock);
    if (
      !source ||
      source.submission.status !== "PENDING" ||
      !config.ISSUE_MEDIA_AUTO_PUBLICATION_MEMBER_IDS.includes(source.submission.memberId)
    )
      return null;
    const ids = [source.submission.mediaAssetAId!, source.submission.mediaAssetBId!];
    const rows = await reader
      .select({ asset: issueMediaAssets, version: issueMediaAssetVersions })
      .from(issueMediaAssets)
      .innerJoin(
        issueMediaAssetVersions,
        and(
          eq(issueMediaAssetVersions.assetId, issueMediaAssets.id),
          eq(issueMediaAssetVersions.version, 1),
          eq(issueMediaAssetVersions.sha256, issueMediaAssets.sha256),
        ),
      )
      .where(inArray(issueMediaAssets.id, ids));
    const ordered = ids.map((id) => rows.find((r) => r.asset.id === id));
    if (
      ordered.some(
        (r) =>
          !r ||
          r.asset.storageState !== "STAGED" ||
          r.asset.moderationState !== "PENDING" ||
          !r.asset.stagingObjectKey ||
          r.version.hashAlgorithm !== "SHA256",
      )
    )
      return null;
    const assets = ordered.map((r) => r!);
    const [blocked] = await reader
      .select({ hash: issueMediaKnownBlockHashes.sha256 })
      .from(issueMediaKnownBlockHashes)
      .where(
        and(
          eq(issueMediaKnownBlockHashes.active, true),
          inArray(
            issueMediaKnownBlockHashes.sha256,
            assets.flatMap((r) => [r.asset.sha256, r.version.inputHash]),
          ),
        ),
      )
      .limit(1);
    if (
      blocked ||
      !clearPublicationEvidence({
        result: source.run.result,
        decision: evaluation.result.decision,
        model: options.safetyModel,
        revision: source.submission.revision,
        hash: source.submission.contentHash,
        imageHashes: assets.map((r) => r.version.inputHash),
      })
    )
      return null;
    // Recheck text before any public object is written; no automatic change to submitted text.
    try {
      normalizeCommand({
        ...source.submission,
        sessionToken: "",
        interestCardCode: source.submission.interestCardCode as InterestCardCode,
      });
    } catch {
      return null;
    }
    return { source, evaluation, assets };
  }

  async function prepare(source: Source) {
    const input = await options.resolveInput({
      targetType: "ISSUE_VERSION",
      targetId: source.submission.id,
      targetVersion: source.target.targetVersion,
      normalizedInputHash: source.run.normalizedInputHash,
      privateObjectReference: source.target.snapshotReference,
      policyVersion: source.run.policyVersion,
    });
    return prepareJudgeRequest(input, source.run.policyVersion);
  }

  async function process(evaluationId: string) {
    if (!enabled()) return { status: "DISABLED" };
    const initial = await evidence(evaluationId);
    if (!initial) return { status: "HELD", reason: "CURRENT_CLEAR_EVIDENCE_REQUIRED" };
    const prepared = await prepare(initial.source);
    if (prepared.cacheKey !== initial.evaluation.cacheKey)
      return { status: "HELD", reason: "INPUT_CHANGED" };
    const bytes: Buffer[] = [];
    for (const row of initial.assets) {
      const body = await storage!.read(row.asset.stagingObjectKey!);
      if (createHash("sha256").update(body).digest("hex") !== row.version.inputHash)
        return { status: "HELD", reason: "PIXEL_HASH_CHANGED" };
      bytes.push(body);
    }
    const attempt = randomUUID();
    const plans = initial.assets.map(({ asset }) => ({
      assetId: asset.id,
      key: `issue-media/published/auto/${attempt}/${asset.id}.webp`,
      privateKey: asset.stagingObjectKey!,
    }));
    // Write-ahead recovery: even a process crash or unknown DB commit leaves discoverable keys.
    // Every recovery operation takes the same submission lock as publication.
    const result = await database.transaction(async (tx) => {
      const current = await evidence(evaluationId, tx, true);
      if (
        !enabled() ||
        !current ||
        current.evaluation.cacheKey !== prepared.cacheKey ||
        current.assets.some(
          (r, i) =>
            r.asset.id !== plans[i]!.assetId ||
            r.asset.stagingObjectKey !== plans[i]!.privateKey ||
            r.version.inputHash !== initial.assets[i]!.version.inputHash,
        )
      )
        return { status: "HELD", reason: "TARGET_CHANGED" };
      // Prevent withdrawal/revocation from racing the final authorization check and commit.
      await tx
        .select()
        .from(members)
        .where(eq(members.id, current.source.submission.memberId))
        .for("share");
      await tx
        .select()
        .from(memberMediaConsents)
        .where(eq(memberMediaConsents.memberId, current.source.submission.memberId))
        .for("share");
      await tx
        .select()
        .from(memberCapabilityGrants)
        .where(eq(memberCapabilityGrants.memberId, current.source.submission.memberId))
        .for("share");
      if (!(await judge.readCurrentSource(current.source.run.id, tx)))
        return { status: "HELD", reason: "ACCESS_CHANGED" };
      // Deliberately committed on a separate connection, while the submission lock is held.
      // Recovery cannot overtake this attempt, and plans survive a rollback of publication.
      await database.insert(moderationReconciliations).values(
        plans.flatMap((p) => [
          {
            targetId: initial.source.target.id,
            resourceType: "R2",
            expectedReference: p.key,
            observedReference: p.assetId,
            status: "MISMATCH",
            repairReference: PUBLIC_REPAIR,
          },
          {
            targetId: initial.source.target.id,
            resourceType: "R2",
            expectedReference: p.privateKey,
            observedReference: p.assetId,
            status: "MISMATCH",
            repairReference: PRIVATE_REPAIR,
          },
        ]),
      );
      for (let i = 0; i < plans.length; i++)
        await storage!.preparePublication!(plans[i]!.key, bytes[i]!);
      if (!enabled() || !(await judge.readCurrentSource(current.source.run.id, tx)))
        throw new Error("PUBLICATION_GATE_CHANGED");
      for (const plan of plans)
        await tx
          .update(issueMediaAssets)
          .set({
            storageState: "PUBLISHED",
            moderationState: "APPROVED",
            publishedObjectKey: plan.key,
            publishedAt: now(),
            updatedAt: now(),
          })
          .where(eq(issueMediaAssets.id, plan.assetId));
      const published = await publishReviewedSubmission(
        tx,
        current.source.submission,
        "AI_PILOT_MEDIA_PUBLISHED",
      );
      if (!published.publishedIssueId) throw new Error("PUBLICATION_NOT_COMMITTED");
      await tx.insert(moderationAuditEvents).values({
        eventType: "AI_PILOT_MEDIA_PUBLISHED",
        entityType: "TARGET",
        entityId: current.source.submission.id,
        actorType: "SYSTEM",
        metadata: {
          policy: AUTO_PUBLICATION_POLICY,
          revision: current.source.submission.revision,
          sourceRunId: current.source.run.id,
          judgeEvaluationId: evaluationId,
          judgeProfile: POLICY_JUDGE_PROFILE,
          imageHashes: current.assets.map((r) => r.version.inputHash),
          publishedIssueId: published.publishedIssueId,
        },
      });
      return { status: "PUBLISHED", issueId: published.publishedIssueId };
    });
    return result;
  }

  async function reconcile() {
    if (!storage) return { repaired: 0 };
    const jobs = await database
      .select({ job: moderationReconciliations, target: moderationTargets })
      .from(moderationReconciliations)
      .innerJoin(moderationTargets, eq(moderationTargets.id, moderationReconciliations.targetId))
      .where(
        and(
          inArray(moderationReconciliations.status, ["MISMATCH", "FAILED"]),
          inArray(moderationReconciliations.repairReference, [PUBLIC_REPAIR, PRIVATE_REPAIR]),
        ),
      )
      .orderBy(asc(moderationReconciliations.checkedAt))
      .limit(50);
    let repaired = 0;
    for (const { job, target } of jobs) {
      try {
        await database.transaction(async (tx) => {
          await lockSubmission(tx, target.targetId);
          const [asset] = await tx
            .select()
            .from(issueMediaAssets)
            .where(eq(issueMediaAssets.id, z.uuid().parse(job.observedReference)))
            .for("update");
          const committed = asset?.publishedObjectKey === job.expectedReference;
          if (job.repairReference === PUBLIC_REPAIR) {
            if (!committed) await storage.purge([job.expectedReference]);
          } else if (
            asset?.storageState === "PUBLISHED" &&
            asset.stagingObjectKey === job.expectedReference &&
            asset.publishedObjectKey
          ) {
            if (!storage.exists || !(await storage.exists(asset.publishedObjectKey)))
              throw new Error("PUBLIC_COPY_MISSING");
            await storage.purge([job.expectedReference]);
            await tx
              .update(issueMediaAssets)
              .set({ stagingObjectKey: null })
              .where(eq(issueMediaAssets.id, asset.id));
          }
          await tx
            .update(moderationReconciliations)
            .set({ status: committed ? "CONSISTENT" : "REPAIRED", resolvedAt: now() })
            .where(eq(moderationReconciliations.id, job.id));
        });
        repaired++;
      } catch {
        await database
          .update(moderationReconciliations)
          .set({ status: "FAILED", checkedAt: now() })
          .where(eq(moderationReconciliations.id, job.id));
      }
    }
    return { repaired };
  }

  async function runBatch(limit = 5) {
    // Recovery is also allowed with the publication kill switch on.
    const recovery = await reconcile();
    if (!enabled()) return { enabled: false, recovery, processed: [] };
    const rows = await database
      .select({ id: policyJudgeEvaluations.id })
      .from(policyJudgeEvaluations)
      .innerJoin(moderationRuns, eq(moderationRuns.id, policyJudgeEvaluations.sourceRunId))
      .innerJoin(moderationTargets, eq(moderationTargets.id, moderationRuns.targetId))
      .innerJoin(
        memberIssueSubmissions,
        and(
          eq(memberIssueSubmissions.id, moderationTargets.targetId),
          eq(memberIssueSubmissions.revision, moderationTargets.targetVersion),
        ),
      )
      .where(
        and(
          eq(memberIssueSubmissions.status, "PENDING"),
          inArray(memberIssueSubmissions.memberId, config.ISSUE_MEDIA_AUTO_PUBLICATION_MEMBER_IDS),
          eq(policyJudgeEvaluations.profile, POLICY_JUDGE_PROFILE),
          inArray(policyJudgeEvaluations.status, ["SUCCEEDED", "CACHE_HIT"]),
          sql`${policyJudgeEvaluations.completedAt} >= ${new Date(now().getTime() - POLICY_JUDGE_CACHE_TTL_MS)}`,
          sql`${policyJudgeEvaluations.result}->'decision'->>'decision' = 'ALLOW'`,
        ),
      )
      .orderBy(asc(policyJudgeEvaluations.completedAt))
      .limit(limit);
    const processed = [];
    for (const row of rows) {
      try {
        processed.push({ evaluationId: row.id, ...(await process(row.id)) });
      } catch {
        processed.push({
          evaluationId: row.id,
          status: "HELD",
          reason: "PUBLICATION_FAILED_RETRYABLE",
        });
      }
    }
    await reconcile();
    return { enabled: true, recovery, processed };
  }
  return { process, runBatch, reconcile, enabled };
}
