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
} from "../../database/schema/index.js";
import { evaluatePublicationReadiness } from "./publication-readiness.js";

export async function readPublicationReadiness(
  database: Pick<Database["db"], "select">,
  input: {
    submissionId: string;
    targetVersion: number;
    inputHash: string;
    runStatus: string;
    runMode: string;
    providerResult: Record<string, unknown>;
    evaluatedAt: Date;
  },
) {
  const [submission] = await database
    .select()
    .from(memberIssueSubmissions)
    .where(eq(memberIssueSubmissions.id, input.submissionId));
  const ids = [submission?.mediaAssetAId, submission?.mediaAssetBId].filter((id): id is string =>
    Boolean(id),
  );
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
  return evaluatePublicationReadiness({
    ...input,
    submission: submission ?? null,
    assets,
    findings,
    knownBlockedHashes: new Set(known.map((row) => row.hash)),
  });
}

// Read-only operational observation. Never reuse a stored readiness flag as approval.
export async function readLatestPublicationReadiness(
  database: Pick<Database["db"], "select">,
  submissionId: string,
  evaluatedAt = new Date(),
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
    readiness: await readPublicationReadiness(database, {
      submissionId,
      targetVersion: latest.target.targetVersion,
      inputHash: latest.run.normalizedInputHash,
      runStatus: latest.run.status,
      runMode: latest.run.mode,
      providerResult: latest.run.result,
      evaluatedAt,
    }),
  };
}
