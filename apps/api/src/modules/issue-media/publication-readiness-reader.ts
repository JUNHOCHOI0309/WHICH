import { and, desc, eq, inArray, like } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../database/client.js";
import {
  issueMediaAssets,
  issueMediaAssetVersions,
  issueMediaKnownBlockHashes,
  issueMediaRuleFindings,
  memberIssueSubmissions,
  moderationRuns,
  moderationTargets,
  members,
  memberCapabilityGrants,
  memberMediaConsents,
} from "../../database/schema/index.js";
import { evaluatePublicationReadiness } from "./publication-readiness.js";
import { resolvePublicationEvidence } from "./publication-evidence.js";
import { moderationDecisionRuntime } from "../moderation/decision-runtime.js";
import type { ModerationDecisionRuntime } from "../moderation/decision-engine.js";

export type PublicationEvidenceOptions = {
  consentVersion: string;
  decisionRuntime: ModerationDecisionRuntime;
};
// Explicit defaults avoid inheriting a caller's environment in tests or library usage.
const defaultOptions: PublicationEvidenceOptions = {
  consentVersion: "which-media-consent-v2",
  decisionRuntime: moderationDecisionRuntime({}),
};

export async function readPublicationReadiness(
  database: Pick<Database["db"], "select">,
  input: {
    submissionId: string;
    targetVersion: number;
    inputHash: string;
    runStatus: string;
    runMode: string;
    runPolicyVersion?: string;
    providerResult: Record<string, unknown>;
    evaluatedAt: Date;
  },
  options: PublicationEvidenceOptions = defaultOptions,
) {
  const [submission] = await database
    .select()
    .from(memberIssueSubmissions)
    .where(eq(memberIssueSubmissions.id, input.submissionId));
  const ids = [
    submission?.contextMediaAssetId,
    submission?.mediaAssetAId,
    submission?.mediaAssetBId,
    submission?.mediaAssetCId,
    submission?.mediaAssetDId,
  ].filter((id): id is string => Boolean(id));
  const assets = ids.length
    ? await database
        .select({
          id: issueMediaAssets.id,
          ownerId: issueMediaAssets.uploadedByMemberId,
          sourceType: issueMediaAssets.sourceType,
          sourceHash: issueMediaAssets.sha256,
          normalizedHash: issueMediaAssetVersions.inputHash,
          processingState: issueMediaAssets.processingState,
          moderationState: issueMediaAssets.moderationState,
          storageState: issueMediaAssets.storageState,
          rightsState: issueMediaAssets.rightsState,
        })
        .from(issueMediaAssets)
        .leftJoin(
          issueMediaAssetVersions,
          and(
            eq(issueMediaAssetVersions.assetId, issueMediaAssets.id),
            eq(issueMediaAssetVersions.version, 1),
            eq(issueMediaAssetVersions.sha256, issueMediaAssets.sha256),
          ),
        )
        .where(inArray(issueMediaAssets.id, ids))
    : [];
  const findings = ids.length
    ? await database
        .select()
        .from(issueMediaRuleFindings)
        .where(inArray(issueMediaRuleFindings.mediaAssetId, ids))
    : [];
  const hashes = assets.flatMap((asset) =>
    [asset.sourceHash, asset.normalizedHash].filter((hash): hash is string => Boolean(hash)),
  );
  const known = hashes.length
    ? await database
        .select({ hash: issueMediaKnownBlockHashes.sha256 })
        .from(issueMediaKnownBlockHashes)
        .where(
          and(
            eq(issueMediaKnownBlockHashes.active, true),
            inArray(issueMediaKnownBlockHashes.sha256, hashes),
          ),
        )
    : [];
  const snapshot = {
    ...input,
    submission: submission ?? null,
    assets,
    findings,
    knownBlockedHashes: new Set(known.map((row) => row.hash)),
  };
  // Read live rows without expiry mutations or borrowing the upload-time access result.
  const [member] = submission
    ? await database
        .select({ id: members.id, status: members.status })
        .from(members)
        .where(eq(members.id, submission.memberId))
    : [];
  const [capability] = submission
    ? await database
        .select({
          id: memberCapabilityGrants.id,
          memberId: memberCapabilityGrants.memberId,
          state: memberCapabilityGrants.state,
          policyVersion: memberCapabilityGrants.policyVersion,
          grantedAt: memberCapabilityGrants.grantedAt,
          expiresAt: memberCapabilityGrants.expiresAt,
        })
        .from(memberCapabilityGrants)
        .where(
          and(
            eq(memberCapabilityGrants.memberId, submission.memberId),
            eq(memberCapabilityGrants.capabilityCode, "ISSUE_IMAGE_UPLOAD"),
          ),
        )
    : [];
  const [consent] = submission
    ? await database
        .select({
          id: memberMediaConsents.id,
          memberId: memberMediaConsents.memberId,
          consentVersion: memberMediaConsents.consentVersion,
          acceptedAt: memberMediaConsents.acceptedAt,
          revokedAt: memberMediaConsents.revokedAt,
        })
        .from(memberMediaConsents)
        .where(
          and(
            eq(memberMediaConsents.memberId, submission.memberId),
            eq(memberMediaConsents.consentVersion, options.consentVersion),
          ),
        )
    : [];
  return {
    ...evaluatePublicationReadiness(snapshot),
    decisionAssessment: resolvePublicationEvidence({
      snapshot,
      access: {
        member: member ?? null,
        capability: capability ?? null,
        consent: consent ?? null,
        requiredConsentVersion: options.consentVersion,
      },
      runtime: options.decisionRuntime,
    }),
  };
}

// Read-only operational observation. Never reuse a stored readiness flag as approval.
export async function readLatestPublicationReadiness(
  database: Pick<Database["db"], "select">,
  submissionId: string,
  evaluatedAt = new Date(),
  options: PublicationEvidenceOptions = defaultOptions,
) {
  z.uuid().parse(submissionId);
  const [latest] = await database
    .select({ run: moderationRuns, target: moderationTargets })
    .from(moderationRuns)
    .innerJoin(moderationTargets, eq(moderationTargets.id, moderationRuns.targetId))
    .where(
      and(
        eq(moderationTargets.targetType, "ISSUE_VERSION"),
        eq(moderationTargets.targetId, submissionId),
        like(moderationTargets.snapshotReference, "issue-submission://revision/%"),
      ),
    )
    .orderBy(
      desc(moderationTargets.targetVersion),
      desc(moderationRuns.createdAt),
      desc(moderationRuns.id),
    )
    .limit(1);
  if (!latest) return { submissionId, executionAuthorized: false, reason: "NO_SUBMISSION_RUN" };
  return {
    submissionId,
    runId: latest.run.id,
    runStatus: latest.run.status,
    readiness: await readPublicationReadiness(
      database,
      {
        submissionId,
        targetVersion: latest.target.targetVersion,
        inputHash: latest.run.normalizedInputHash,
        runStatus: latest.run.status,
        runMode: latest.run.mode,
        runPolicyVersion: latest.run.policyVersion,
        providerResult: latest.run.result,
        evaluatedAt,
      },
      options,
    ),
  };
}
