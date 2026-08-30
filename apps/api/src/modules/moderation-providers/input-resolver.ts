import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";
import sharp from "sharp";

import type { Database } from "../../database/client.js";
import {
  commentRevisions,
  issueMediaAssetVersions,
  issueMediaAssets,
  issueVersionSnapshots,
  memberIssueSubmissionRevisions,
} from "../../database/schema/index.js";
import type { IssueMediaObjectStorage } from "../issue-media/contracts.js";
import { buildExternalImageModerationEnvelope } from "../moderation/provider-privacy-policy.js";
import type { ModerationShadowAdapter } from "../moderation-dispatch/contracts.js";
import { ModerationProviderCallError, type ModerationProviderInput } from "./contracts.js";
import {
  EMBEDDED_TEXT_VERSION,
  minimizeEmbeddedText,
  type EmbeddedText,
} from "../issue-media/embedded-text.js";

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

function unavailable(code: string): never {
  throw new ModerationProviderCallError("INPUT_UNAVAILABLE", code, false);
}

export function createModerationProviderInputResolver(input: {
  database: Database["db"];
  storage: IssueMediaObjectStorage | null;
  extractEmbeddedText?: (bytes: Buffer) => Promise<EmbeddedText>;
}): (
  target: Parameters<ModerationShadowAdapter["inspect"]>[0],
) => Promise<ModerationProviderInput> {
  async function resolveImage(
    assetId: string,
    version: number,
    expectedHash?: string,
    owner?: string,
  ) {
    if (!input.storage) unavailable("ISSUE_MEDIA_STORAGE_DISABLED");
    const [row] = await input.database
      .select({ asset: issueMediaAssets, snapshot: issueMediaAssetVersions })
      .from(issueMediaAssetVersions)
      .innerJoin(issueMediaAssets, eq(issueMediaAssets.id, issueMediaAssetVersions.assetId))
      .where(
        and(
          eq(issueMediaAssetVersions.assetId, assetId),
          eq(issueMediaAssetVersions.version, version),
        ),
      )
      .limit(1);
    if (!row) unavailable("ISSUE_MEDIA_VERSION_NOT_FOUND");
    const { asset, snapshot } = row;
    if (
      snapshot.hashAlgorithm !== "SHA256" ||
      (expectedHash && snapshot.inputHash !== expectedHash) ||
      asset.sha256 !== snapshot.sha256 ||
      asset.processingState !== "READY" ||
      !["STAGED", "PUBLISHED"].includes(asset.storageState) ||
      !["PENDING", "APPROVED"].includes(asset.moderationState) ||
      !["ASSERTED", "CLEARED"].includes(asset.rightsState) ||
      (owner && (asset.uploadedByMemberId !== owner || asset.sourceType !== "MEMBER_SUBMISSION"))
    )
      unavailable("ISSUE_MEDIA_VERSION_UNAVAILABLE");
    const objectKey =
      asset.storageState === "PUBLISHED" ? asset.publishedObjectKey : asset.stagingObjectKey;
    if (!objectKey) unavailable("ISSUE_MEDIA_OBJECT_NOT_FOUND");
    const bytes = await input.storage
      .read(objectKey)
      .catch(() => unavailable("ISSUE_MEDIA_OBJECT_UNAVAILABLE"));
    if (createHash("sha256").update(bytes).digest("hex") !== snapshot.inputHash) {
      unavailable("ISSUE_MEDIA_BINARY_HASH_MISMATCH");
    }
    const derivative = await normalizeProviderImage(bytes);
    // Extraction sees the same hash-verified canonical pixels, not an arbitrary image or cached text.
    const extracted = input.extractEmbeddedText
      ? await input.extractEmbeddedText(bytes).catch(() => ({
          version: EMBEDDED_TEXT_VERSION,
          status: "UNAVAILABLE" as const,
          text: "",
        }))
      : { version: EMBEDDED_TEXT_VERSION, status: "UNAVAILABLE" as const, text: "" };
    const embeddedText =
      extracted.status === "WITHHELD_PII"
        ? { ...extracted, text: "" }
        : minimizeEmbeddedText(extracted.text, extracted.status);
    const envelope = buildExternalImageModerationEnvelope({
      provider: "OPENAI_MODERATION",
      opaqueRequestId: snapshot.inputHash.slice(0, 32),
      derivative: {
        mimeType: "image/webp",
        width: derivative.info.width,
        height: derivative.info.height,
        byteLength: derivative.data.byteLength,
        metadataStripped: true,
        reencoded: true,
        content: derivative.data.toString("base64"),
      },
    });
    const image = {
      dataUrl: `data:${envelope.media.mimeType};base64,${envelope.media.content}`,
      mimeType: envelope.media.mimeType,
      width: envelope.media.width,
      height: envelope.media.height,
      byteLength: envelope.media.byteLength,
      metadataStripped: true as const,
      reencoded: true as const,
    };
    return { image, embeddedText, normalizedHash: snapshot.inputHash };
  }

  return async (target) => {
    if (target.targetType === "COMMENT_VERSION") {
      const [row] = await input.database
        .select({ body: commentRevisions.body, inputHash: commentRevisions.inputHash })
        .from(commentRevisions)
        .where(
          and(
            eq(commentRevisions.commentId, target.targetId),
            eq(commentRevisions.revision, target.targetVersion),
          ),
        )
        .limit(1);
      if (!row || row.inputHash !== target.normalizedInputHash)
        unavailable("COMMENT_VERSION_MISMATCH");
      return {
        targetType: target.targetType,
        scope: "COMMENT_REVISION",
        modality: "TEXT",
        text: normalizeText(row.body),
      };
    }

    if (target.targetType === "ISSUE_VERSION") {
      if (
        target.privateObjectReference ===
        `issue-submission://revision/${target.targetId}/${target.targetVersion}`
      ) {
        const [submission] = await input.database
          .select()
          .from(memberIssueSubmissionRevisions)
          .where(
            and(
              eq(memberIssueSubmissionRevisions.submissionId, target.targetId),
              eq(memberIssueSubmissionRevisions.revision, target.targetVersion),
            ),
          )
          .limit(1);
        if (!submission || submission.contentHash !== target.normalizedInputHash)
          unavailable("SUBMISSION_VERSION_MISMATCH");
        const ids = [submission.mediaAssetAId, submission.mediaAssetBId];
        if (ids.some(Boolean) && (!ids.every(Boolean) || ids[0] === ids[1]))
          unavailable("SUBMISSION_MEDIA_PAIR_INVALID");
        // Bind both images to this immutable question revision, never an arbitrary linked revision.
        const resolvedImages = [];
        for (const id of ids) {
          if (id) resolvedImages.push(await resolveImage(id, 1, undefined, submission.memberId));
        }
        const images = resolvedImages.map((resolved) => resolved.image);
        const context = {
          question: redactProviderContext(submission.question),
          choices: [submission.choiceA, submission.choiceB].map(redactProviderContext),
          piiRedacted: true as const,
        };
        const text = normalizeText(
          [
            context.question,
            redactProviderContext(submission.context ?? ""),
            ...context.choices.map((choice, index) => `${index === 0 ? "A" : "B"}: ${choice}`),
          ]
            .filter(Boolean)
            .join("\n"),
          MAX_CONTEXT_CHARACTERS,
        );
        return {
          targetType: target.targetType,
          scope: "SUBMISSION_REVISION",
          modality: images.length ? "TEXT_AND_IMAGE" : "TEXT",
          text: [
            text,
            ...resolvedImages.map((resolved, index) =>
              resolved.embeddedText.text
                ? `Image ${index === 0 ? "A" : "B"} extracted text: ${resolved.embeddedText.text}`
                : "",
            ),
          ]
            .filter(Boolean)
            .join("\n"),
          images,
          ...(images.length
            ? {
                embeddedText: {
                  version: EMBEDDED_TEXT_VERSION,
                  images: resolvedImages.map((resolved) => ({
                    normalizedHash: resolved.normalizedHash,
                    status: resolved.embeddedText.status,
                    characters: resolved.embeddedText.text.length,
                  })),
                },
              }
            : {}),
          context,
        };
      }
      const [snapshot] = await input.database
        .select()
        .from(issueVersionSnapshots)
        .where(
          and(
            eq(issueVersionSnapshots.issueId, target.targetId),
            eq(issueVersionSnapshots.issueVersion, target.targetVersion),
          ),
        )
        .limit(1);
      if (!snapshot || snapshot.inputHash !== target.normalizedInputHash)
        unavailable("ISSUE_VERSION_MISMATCH");
      return {
        targetType: target.targetType,
        scope: "ISSUE_SNAPSHOT",
        modality: "TEXT",
        text: normalizeText(
          [
            snapshot.question,
            snapshot.context,
            ...snapshot.choicesSnapshot.map(({ label }) => label),
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      };
    }

    // Asset hashes cover pixels, not the context of a later submission or published Issue.
    if (
      target.privateObjectReference !==
      `issue-media://asset/${target.targetId}/version/${target.targetVersion}`
    )
      unavailable("ISSUE_MEDIA_REFERENCE_MISMATCH");
    const resolved = await resolveImage(
      target.targetId,
      target.targetVersion,
      target.normalizedInputHash,
    );
    return {
      targetType: target.targetType,
      scope: "ASSET_ONLY",
      modality: resolved.embeddedText.text ? "TEXT_AND_IMAGE" : "IMAGE",
      ...(resolved.embeddedText.text
        ? { text: `Image extracted text: ${resolved.embeddedText.text}` }
        : {}),
      images: [resolved.image],
      embeddedText: {
        version: EMBEDDED_TEXT_VERSION,
        images: [
          {
            normalizedHash: resolved.normalizedHash,
            status: resolved.embeddedText.status,
            characters: resolved.embeddedText.text.length,
          },
        ],
      },
    };
  };
}
