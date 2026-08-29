import { and, eq, or } from "drizzle-orm";
import sharp from "sharp";

import type { Database } from "../../database/client.js";
import {
  commentRevisions,
  issueChoiceMediaRevisions,
  issueMediaAssets,
  issueVersionSnapshots,
  memberIssueSubmissionRevisions,
} from "../../database/schema/index.js";
import type { IssueMediaObjectStorage } from "../issue-media/contracts.js";
import { buildExternalImageModerationEnvelope } from "../moderation/provider-privacy-policy.js";
import type { ModerationShadowAdapter } from "../moderation-dispatch/contracts.js";
import { ModerationProviderCallError, type ModerationProviderInput } from "./contracts.js";

const MAX_TEXT_CHARACTERS = 8_000;
const MAX_CONTEXT_CHARACTERS = 1_500;

function normalizeText(value: string | null | undefined, limit = MAX_TEXT_CHARACTERS) {
  return (value ?? "").replace(/\s+/gu, " ").trim().slice(0, limit);
}

export function redactProviderContext(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[EMAIL_REDACTED]")
    .replace(/(?:https?:\/\/|www\.)\S+/giu, "[URL_REDACTED]")
    .replace(/(?:\+?82[- ]?)?0?1[016789][- ]?\d{3,4}[- ]?\d{4}/gu, "[PHONE_REDACTED]")
    .slice(0, MAX_CONTEXT_CHARACTERS);
}

export async function normalizeProviderImage(bytes: Buffer) {
  return sharp(bytes)
    .rotate()
    .resize({ width: 1_024, height: 1_024, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
}

export function createModerationProviderInputResolver(input: {
  database: Database["db"];
  storage: IssueMediaObjectStorage | null;
}): (
  target: Parameters<ModerationShadowAdapter["inspect"]>[0],
) => Promise<ModerationProviderInput> {
  return async (target) => {
    if (target.targetType === "COMMENT_VERSION") {
      const [row] = await input.database
        .select({ body: commentRevisions.body })
        .from(commentRevisions)
        .where(
          and(
            eq(commentRevisions.commentId, target.targetId),
            eq(commentRevisions.revision, target.targetVersion),
          ),
        )
        .limit(1);
      if (!row)
        throw new ModerationProviderCallError("INPUT_UNAVAILABLE", "COMMENT_NOT_FOUND", false);
      return { targetType: target.targetType, modality: "TEXT", text: normalizeText(row.body) };
    }

    if (target.targetType === "ISSUE_VERSION") {
      const [snapshot] = await input.database
        .select({
          question: issueVersionSnapshots.question,
          context: issueVersionSnapshots.context,
          choices: issueVersionSnapshots.choicesSnapshot,
        })
        .from(issueVersionSnapshots)
        .where(
          and(
            eq(issueVersionSnapshots.issueId, target.targetId),
            eq(issueVersionSnapshots.issueVersion, target.targetVersion),
          ),
        )
        .limit(1);
      if (snapshot) {
        return {
          targetType: target.targetType,
          modality: "TEXT",
          text: normalizeText(
            [snapshot.question, snapshot.context, ...snapshot.choices.map(({ label }) => label)]
              .filter(Boolean)
              .join("\n"),
          ),
        };
      }
      const [submission] = await input.database
        .select({
          question: memberIssueSubmissionRevisions.question,
          context: memberIssueSubmissionRevisions.context,
          choiceA: memberIssueSubmissionRevisions.choiceA,
          choiceB: memberIssueSubmissionRevisions.choiceB,
        })
        .from(memberIssueSubmissionRevisions)
        .where(
          and(
            eq(memberIssueSubmissionRevisions.submissionId, target.targetId),
            eq(memberIssueSubmissionRevisions.revision, target.targetVersion),
          ),
        )
        .limit(1);
      if (!submission) {
        throw new ModerationProviderCallError(
          "INPUT_UNAVAILABLE",
          "ISSUE_VERSION_NOT_FOUND",
          false,
        );
      }
      return {
        targetType: target.targetType,
        modality: "TEXT",
        text: normalizeText(
          [submission.question, submission.context, submission.choiceA, submission.choiceB]
            .filter(Boolean)
            .join("\n"),
        ),
      };
    }

    if (!input.storage) {
      throw new ModerationProviderCallError(
        "INPUT_UNAVAILABLE",
        "ISSUE_MEDIA_STORAGE_DISABLED",
        false,
      );
    }
    const [asset] = await input.database
      .select({
        stagingObjectKey: issueMediaAssets.stagingObjectKey,
        publishedObjectKey: issueMediaAssets.publishedObjectKey,
        quarantinedObjectKey: issueMediaAssets.quarantinedObjectKey,
      })
      .from(issueMediaAssets)
      .where(eq(issueMediaAssets.id, target.targetId))
      .limit(1);
    const objectKey =
      asset?.stagingObjectKey ?? asset?.publishedObjectKey ?? asset?.quarantinedObjectKey ?? null;
    if (!objectKey) {
      throw new ModerationProviderCallError(
        "INPUT_UNAVAILABLE",
        "ISSUE_MEDIA_OBJECT_NOT_FOUND",
        false,
      );
    }

    const [linked] = await input.database
      .select({
        issueId: issueChoiceMediaRevisions.issueId,
        issueVersion: issueChoiceMediaRevisions.issueVersion,
        altText: issueChoiceMediaRevisions.altText,
      })
      .from(issueChoiceMediaRevisions)
      .where(eq(issueChoiceMediaRevisions.mediaAssetId, target.targetId))
      .limit(1);
    const [snapshot] = linked
      ? await input.database
          .select({
            question: issueVersionSnapshots.question,
            choices: issueVersionSnapshots.choicesSnapshot,
          })
          .from(issueVersionSnapshots)
          .where(
            and(
              eq(issueVersionSnapshots.issueId, linked.issueId),
              eq(issueVersionSnapshots.issueVersion, linked.issueVersion),
            ),
          )
          .limit(1)
      : [];
    const [submission] = !snapshot
      ? await input.database
          .select({
            question: memberIssueSubmissionRevisions.question,
            choiceA: memberIssueSubmissionRevisions.choiceA,
            choiceB: memberIssueSubmissionRevisions.choiceB,
          })
          .from(memberIssueSubmissionRevisions)
          .where(
            or(
              eq(memberIssueSubmissionRevisions.mediaAssetAId, target.targetId),
              eq(memberIssueSubmissionRevisions.mediaAssetBId, target.targetId),
            ),
          )
          .limit(1)
      : [];

    const bytes = await input.storage.read(objectKey);
    const derivative = await normalizeProviderImage(bytes);
    const context = {
      question: redactProviderContext(snapshot?.question ?? submission?.question ?? ""),
      choices: (
        snapshot?.choices.map(({ label }) => label) ??
        [submission?.choiceA, submission?.choiceB].filter((value): value is string =>
          Boolean(value),
        )
      ).map(redactProviderContext),
      altText: redactProviderContext(linked?.altText ?? ""),
      piiRedacted: true as const,
    };
    const content = derivative.data.toString("base64");
    const envelope = buildExternalImageModerationEnvelope({
      provider: "OPENAI_MODERATION",
      opaqueRequestId: target.normalizedInputHash.slice(0, 32),
      derivative: {
        mimeType: "image/webp",
        width: derivative.info.width,
        height: derivative.info.height,
        byteLength: derivative.data.byteLength,
        metadataStripped: true,
        reencoded: true,
        content,
      },
      context,
    });
    const contextText = normalizeText(
      [context.question, ...(context.choices ?? []), context.altText].filter(Boolean).join("\n"),
      MAX_CONTEXT_CHARACTERS,
    );
    return {
      targetType: target.targetType,
      modality: contextText ? "TEXT_AND_IMAGE" : "IMAGE",
      ...(contextText ? { text: contextText } : {}),
      image: {
        dataUrl: `data:${envelope.media.mimeType};base64,${envelope.media.content}`,
        mimeType: envelope.media.mimeType,
        width: envelope.media.width,
        height: envelope.media.height,
        byteLength: envelope.media.byteLength,
        metadataStripped: true,
        reencoded: true,
      },
      context: envelope.context,
    };
  };
}
