import { createHash } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  commentRevisions,
  issueChoiceMedia,
  issueChoices,
  issueMediaAssets,
  issueMediaAssetVersions,
  issueVersionSnapshots,
  issueVersions,
  moderationRecheckRequests,
  type IssueChoiceSnapshot,
  type IssueMediaSnapshot,
} from "../../database/schema/index.js";
import type {
  ContentRevisionService,
  CreateModerationRecheckCommand,
  ModerationRecheckRequest,
} from "./contracts.js";

type RevisionExecutor = Pick<Database["db"], "select" | "insert">;

export class ContentRevisionError extends Error {
  constructor(
    public readonly code: "REVISION_NOT_FOUND" | "IDEMPOTENCY_CONFLICT",
    public readonly statusCode: 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "ContentRevisionError";
  }
}

export function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown) {
  return JSON.stringify(value, (_key, item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      );
    }
    return item as unknown;
  });
}

export async function sealIssueVersionSnapshot(
  database: RevisionExecutor,
  issueId: string,
  issueVersion: number,
  policyVersion = "issue-snapshot-v1",
) {
  const [version] = await database
    .select()
    .from(issueVersions)
    .where(and(eq(issueVersions.issueId, issueId), eq(issueVersions.version, issueVersion)))
    .limit(1);
  if (!version) throw new Error("Cannot seal a missing Issue version.");

  const choices: IssueChoiceSnapshot[] = await database
    .select({ id: issueChoices.id, code: issueChoices.code, label: issueChoices.label })
    .from(issueChoices)
    .where(and(eq(issueChoices.issueId, issueId), eq(issueChoices.issueVersion, issueVersion)))
    .orderBy(asc(issueChoices.code), asc(issueChoices.id));

  const media: IssueMediaSnapshot[] = await database
    .select({
      choiceId: issueChoiceMedia.choiceId,
      choiceCode: issueChoices.code,
      assetId: issueChoiceMedia.mediaAssetId,
      sha256: issueMediaAssets.sha256,
      altText: issueChoiceMedia.altText,
      cropMode: issueChoiceMedia.cropMode,
      displayPosition: issueChoiceMedia.displayPosition,
      rightsAttestation: issueMediaAssets.rightsAttestation,
    })
    .from(issueChoiceMedia)
    .innerJoin(issueChoices, eq(issueChoices.id, issueChoiceMedia.choiceId))
    .innerJoin(issueMediaAssets, eq(issueMediaAssets.id, issueChoiceMedia.mediaAssetId))
    .where(
      and(eq(issueChoiceMedia.issueId, issueId), eq(issueChoiceMedia.issueVersion, issueVersion)),
    )
    .orderBy(asc(issueChoiceMedia.displayPosition), asc(issueChoiceMedia.choiceId))
    .then((rows) => rows.map((row) => ({ ...row, assetVersion: 1 })));

  const snapshot = {
    issueId,
    issueVersion,
    question: version.question,
    context: version.context,
    sourceContentHash: version.contentHash,
    choices,
    media,
  };
  const inputHash = sha256(canonicalJson(snapshot));
  const [sealed] = await database
    .insert(issueVersionSnapshots)
    .values({
      issueId,
      issueVersion,
      question: version.question,
      context: version.context,
      choicesSnapshot: choices,
      mediaSnapshot: media,
      sourceContentHash: version.contentHash,
      inputHash,
      policyVersion,
    })
    .onConflictDoNothing()
    .returning();

  if (sealed) return sealed;
  const [existing] = await database
    .select()
    .from(issueVersionSnapshots)
    .where(
      and(
        eq(issueVersionSnapshots.issueId, issueId),
        eq(issueVersionSnapshots.issueVersion, issueVersion),
      ),
    )
    .limit(1);
  if (!existing || existing.inputHash !== inputHash) {
    throw new Error("The sealed Issue version differs from the current immutable source.");
  }
  return existing;
}

function toRecord(row: typeof moderationRecheckRequests.$inferSelect): ModerationRecheckRequest {
  return {
    id: row.id,
    targetType: row.targetType as ModerationRecheckRequest["targetType"],
    targetId: row.targetId,
    targetVersion: row.targetVersion,
    policyVersion: row.policyVersion,
    inputHash: row.inputHash,
    normalizedSnapshotRef: row.normalizedSnapshotRef,
    ocrTranscriptRef: row.ocrTranscriptRef,
    reason: row.reason as ModerationRecheckRequest["reason"],
    status: row.status as ModerationRecheckRequest["status"],
    requestedAt: row.requestedAt.toISOString(),
  };
}

async function targetExists(database: Database["db"], command: CreateModerationRecheckCommand) {
  if (command.targetType === "COMMENT_REVISION") {
    const [row] = await database
      .select({ id: commentRevisions.id })
      .from(commentRevisions)
      .where(
        and(
          eq(commentRevisions.commentId, command.targetId),
          eq(commentRevisions.revision, command.targetVersion),
          eq(commentRevisions.inputHash, command.inputHash),
        ),
      )
      .limit(1);
    return Boolean(row);
  }
  if (command.targetType === "ISSUE_VERSION") {
    const [row] = await database
      .select({ issueId: issueVersionSnapshots.issueId })
      .from(issueVersionSnapshots)
      .where(
        and(
          eq(issueVersionSnapshots.issueId, command.targetId),
          eq(issueVersionSnapshots.issueVersion, command.targetVersion),
          eq(issueVersionSnapshots.inputHash, command.inputHash),
        ),
      )
      .limit(1);
    return Boolean(row);
  }
  const [row] = await database
    .select({ assetId: issueMediaAssetVersions.assetId })
    .from(issueMediaAssetVersions)
    .where(
      and(
        eq(issueMediaAssetVersions.assetId, command.targetId),
        eq(issueMediaAssetVersions.version, command.targetVersion),
        eq(issueMediaAssetVersions.inputHash, command.inputHash),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export function createContentRevisionService(database: Database["db"]): ContentRevisionService {
  return {
    async requestModerationRecheck(command) {
      if (!(await targetExists(database, command))) {
        throw new ContentRevisionError(
          "REVISION_NOT_FOUND",
          404,
          "The immutable target revision and input hash were not found.",
        );
      }

      const [created] = await database
        .insert(moderationRecheckRequests)
        .values({
          targetType: command.targetType,
          targetId: command.targetId,
          targetVersion: command.targetVersion,
          policyVersion: command.policyVersion,
          inputHash: command.inputHash,
          normalizedSnapshotRef: command.normalizedSnapshotRef,
          ocrTranscriptRef: command.ocrTranscriptRef,
          reason: command.reason,
        })
        .onConflictDoNothing()
        .returning();

      if (created) return { created: true, request: toRecord(created) };
      const [existing] = await database
        .select()
        .from(moderationRecheckRequests)
        .where(
          and(
            eq(moderationRecheckRequests.targetType, command.targetType),
            eq(moderationRecheckRequests.targetId, command.targetId),
            eq(moderationRecheckRequests.targetVersion, command.targetVersion),
            eq(moderationRecheckRequests.policyVersion, command.policyVersion),
            eq(moderationRecheckRequests.inputHash, command.inputHash),
          ),
        )
        .limit(1);
      if (!existing) throw new Error("The idempotent moderation request could not be loaded.");
      if (
        existing.normalizedSnapshotRef !== command.normalizedSnapshotRef ||
        existing.ocrTranscriptRef !== (command.ocrTranscriptRef ?? null)
      ) {
        throw new ContentRevisionError(
          "IDEMPOTENCY_CONFLICT",
          409,
          "This moderation recheck key was already used with different evidence references.",
        );
      }
      return { created: false, request: toRecord(existing) };
    },
  };
}

export const RETENTION_PRECEDENCE = {
  CONTENT_DELETION: 100,
  MEMBER_DELETION: 200,
  APPEAL: 300,
  RIGHTS: 400,
  LEGAL_HOLD: 500,
} as const;

export function resolveRetentionDirective<
  T extends { directiveType: keyof typeof RETENTION_PRECEDENCE; releasedAt?: Date | null },
>(directives: T[]): T | null {
  return (
    directives
      .filter((directive) => !directive.releasedAt)
      .sort(
        (left, right) =>
          RETENTION_PRECEDENCE[right.directiveType] - RETENTION_PRECEDENCE[left.directiveType],
      )[0] ?? null
  );
}
