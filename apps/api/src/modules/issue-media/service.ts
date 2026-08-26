import { randomUUID } from "node:crypto";

import { and, eq, isNull, lt, sql } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  issueChoiceMedia,
  issueChoices,
  issueMediaAssets,
  issueVersions,
  members,
  operatorAccessGrants,
  operatorAuditLogs,
} from "../../database/schema/index.js";

import type {
  IssueMediaAssetRecord,
  IssueMediaObjectStorage,
  IssueMediaService,
} from "./contracts.js";
import { IssueMediaProcessingError, processIssueMedia } from "./image-processing.js";

export class IssueMediaError extends Error {
  constructor(
    public readonly code:
      | IssueMediaProcessingError["code"]
      | "MEDIA_DUPLICATE"
      | "MEDIA_NOT_FOUND"
      | "MEDIA_STATE_CONFLICT"
      | "MEDIA_RIGHTS_BLOCKED"
      | "ISSUE_CHOICE_NOT_FOUND"
      | "ISSUE_VERSION_LOCKED"
      | "MEDIA_STORAGE_UNAVAILABLE",
    public readonly statusCode: 400 | 404 | 409 | 422 | 503,
    message: string,
  ) {
    super(message);
    this.name = "IssueMediaError";
  }
}

function mediaError(error: unknown): never {
  if (error instanceof IssueMediaError) throw error;
  if (error instanceof IssueMediaProcessingError) {
    throw new IssueMediaError(error.code, 422, error.message);
  }
  throw error;
}

function mapAsset(
  row: typeof issueMediaAssets.$inferSelect,
  storage: IssueMediaObjectStorage,
): IssueMediaAssetRecord {
  return {
    id: row.id,
    sourceType: row.sourceType as "OPERATOR_UPLOAD",
    sha256: row.sha256,
    perceptualHash: row.perceptualHash,
    input: {
      mimeType: row.inputMimeType as IssueMediaAssetRecord["input"]["mimeType"],
      byteSize: row.inputByteSize,
      width: row.inputWidth,
      height: row.inputHeight,
    },
    output: {
      mimeType: "image/webp",
      byteSize: row.outputByteSize,
      width: row.outputWidth,
      height: row.outputHeight,
    },
    processingState: row.processingState as IssueMediaAssetRecord["processingState"],
    moderationState: row.moderationState as IssueMediaAssetRecord["moderationState"],
    storageState: row.storageState as IssueMediaAssetRecord["storageState"],
    rightsState: row.rightsState as IssueMediaAssetRecord["rightsState"],
    publishedUrl:
      row.storageState === "PUBLISHED" && row.publishedObjectKey
        ? storage.publicUrl(row.publishedObjectKey)
        : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createIssueMediaService(
  database: Database["db"],
  storage: IssueMediaObjectStorage,
): IssueMediaService {
  async function operator(memberId: string) {
    const [row] = await database
      .select({ id: members.id })
      .from(operatorAccessGrants)
      .innerJoin(members, eq(members.id, operatorAccessGrants.memberId))
      .where(
        and(
          eq(operatorAccessGrants.memberId, memberId),
          eq(operatorAccessGrants.role, "OPERATOR"),
          isNull(operatorAccessGrants.revokedAt),
          eq(members.status, "ACTIVE"),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async function audit(input: {
    memberId: string;
    eventType: string;
    outcome: "DENIED" | "SUCCEEDED" | "FAILED";
    requestId?: string;
    metadata?: Record<string, unknown>;
  }) {
    await database.insert(operatorAuditLogs).values({
      memberId: input.memberId,
      eventType: input.eventType,
      outcome: input.outcome,
      requestId: input.requestId,
      metadata: input.metadata ?? {},
    });
  }

  async function requireOperator(
    memberId: string,
    eventType: string,
    requestId?: string,
  ): Promise<boolean> {
    if (await operator(memberId)) return true;
    await audit({
      memberId,
      eventType,
      outcome: "DENIED",
      requestId,
      metadata: { reason: "OPERATOR_ROLE_REQUIRED" },
    });
    return false;
  }

  async function asset(assetId: string) {
    const [row] = await database
      .select()
      .from(issueMediaAssets)
      .where(eq(issueMediaAssets.id, assetId))
      .limit(1);
    if (!row) throw new IssueMediaError("MEDIA_NOT_FOUND", 404, "The media asset was not found.");
    return row;
  }

  async function quarantineStoredAsset(
    row: typeof issueMediaAssets.$inferSelect,
    reason: "ISSUE_BLINDED" | "RIGHTS_CHALLENGED" | "MODERATION_REVOKED",
  ) {
    if (row.storageState === "QUARANTINED") {
      if (reason !== "RIGHTS_CHALLENGED" || row.rightsState === "CHALLENGED") return row;
      const [updated] = await database
        .update(issueMediaAssets)
        .set({ rightsState: "CHALLENGED", updatedAt: new Date() })
        .where(eq(issueMediaAssets.id, row.id))
        .returning();
      return updated!;
    }
    if (row.storageState === "PURGED") {
      throw new IssueMediaError(
        "MEDIA_STATE_CONFLICT",
        409,
        "A purged asset cannot be quarantined.",
      );
    }
    const object = await storage.quarantine({
      assetId: row.id,
      stagingObjectKey: row.stagingObjectKey,
      publishedObjectKey: row.publishedObjectKey,
    });
    const [updated] = await database
      .update(issueMediaAssets)
      .set({
        storageState: "QUARANTINED",
        moderationState: "REVOKED",
        rightsState: reason === "RIGHTS_CHALLENGED" ? "CHALLENGED" : row.rightsState,
        stagingObjectKey: null,
        publishedObjectKey: null,
        quarantinedObjectKey: object.objectKey,
        quarantinedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(issueMediaAssets.id, row.id))
      .returning();
    return updated!;
  }

  async function purgeStoredAsset(
    row: typeof issueMediaAssets.$inferSelect,
    reason: "ISSUE_DELETED" | "RIGHTS_WITHDRAWN" | "ORPHAN_CLEANUP",
  ) {
    if (row.storageState === "PURGED") return row;
    await storage.purge([row.stagingObjectKey, row.publishedObjectKey, row.quarantinedObjectKey]);
    const affectedLinks = await database
      .delete(issueChoiceMedia)
      .where(eq(issueChoiceMedia.mediaAssetId, row.id))
      .returning({
        issueId: issueChoiceMedia.issueId,
        issueVersion: issueChoiceMedia.issueVersion,
      });
    for (const link of affectedLinks) {
      await database
        .update(issueVersions)
        .set({ mediaMode: "TEXT_ONLY" })
        .where(
          and(
            eq(issueVersions.issueId, link.issueId),
            eq(issueVersions.version, link.issueVersion),
            isNull(issueVersions.publishedAt),
          ),
        );
    }
    const [updated] = await database
      .update(issueMediaAssets)
      .set({
        storageState: "PURGED",
        moderationState: row.moderationState === "PENDING" ? "REJECTED" : "REVOKED",
        rightsState: reason === "RIGHTS_WITHDRAWN" ? "WITHDRAWN" : row.rightsState,
        stagingObjectKey: null,
        publishedObjectKey: null,
        quarantinedObjectKey: null,
        purgedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(issueMediaAssets.id, row.id))
      .returning();
    return updated!;
  }

  return {
    async stageAsset(input) {
      const eventType = "OPS_ISSUE_MEDIA_STAGE";
      if (!(await requireOperator(input.memberId, eventType, input.requestId))) return null;
      try {
        const rightsAttestation = input.rightsAttestation.trim();
        if (rightsAttestation.length < 20 || rightsAttestation.length > 2000) {
          throw new IssueMediaError(
            "MEDIA_RIGHTS_BLOCKED",
            422,
            "A 20-2000 character rights attestation is required.",
          );
        }
        const processed = await processIssueMedia(input.bytes, input.declaredMimeType).catch(
          mediaError,
        );
        const [duplicate] = await database
          .select({ id: issueMediaAssets.id })
          .from(issueMediaAssets)
          .where(eq(issueMediaAssets.sha256, processed.sha256))
          .limit(1);
        if (duplicate) {
          throw new IssueMediaError(
            "MEDIA_DUPLICATE",
            409,
            `This exact image already exists as asset ${duplicate.id}.`,
          );
        }
        const id = randomUUID();
        const staged = await storage.stage(id, processed.body);
        try {
          const [created] = await database
            .insert(issueMediaAssets)
            .values({
              id,
              uploadedByMemberId: input.memberId,
              sourceType: input.sourceType,
              rightsAttestation,
              rightsAttestedAt: new Date(),
              sha256: processed.sha256,
              perceptualHash: processed.perceptualHash,
              inputMimeType: processed.input.mimeType,
              inputByteSize: processed.input.byteSize,
              inputWidth: processed.input.width,
              inputHeight: processed.input.height,
              outputByteSize: processed.output.byteSize,
              outputWidth: processed.output.width,
              outputHeight: processed.output.height,
              stagingObjectKey: staged.objectKey,
              stagedAt: new Date(),
            })
            .returning();
          await audit({
            memberId: input.memberId,
            eventType,
            outcome: "SUCCEEDED",
            requestId: input.requestId,
            metadata: { assetId: id, sha256: processed.sha256 },
          });
          return mapAsset(created!, storage);
        } catch (error) {
          await storage.purge([staged.objectKey]).catch(() => undefined);
          throw error;
        }
      } catch (error) {
        await audit({
          memberId: input.memberId,
          eventType,
          outcome: "FAILED",
          requestId: input.requestId,
          metadata: { code: error instanceof IssueMediaError ? error.code : "UNKNOWN" },
        }).catch(() => undefined);
        mediaError(error);
      }
    },

    async approveAndPublish(input) {
      const eventType = "OPS_ISSUE_MEDIA_PUBLISH";
      if (!(await requireOperator(input.memberId, eventType, input.requestId))) return null;
      const row = await asset(input.assetId);
      if (row.processingState !== "READY" || row.storageState !== "STAGED") {
        throw new IssueMediaError(
          "MEDIA_STATE_CONFLICT",
          409,
          "Only a ready staged asset can be published.",
        );
      }
      if (!row.stagingObjectKey || !["ASSERTED", "CLEARED"].includes(row.rightsState)) {
        throw new IssueMediaError(
          "MEDIA_RIGHTS_BLOCKED",
          409,
          "The media asset does not have publishable rights state.",
        );
      }
      const published = await storage.publish(row.id, row.stagingObjectKey);
      try {
        const [updated] = await database
          .update(issueMediaAssets)
          .set({
            moderationState: "APPROVED",
            storageState: "PUBLISHED",
            stagingObjectKey: null,
            publishedObjectKey: published.objectKey,
            publishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(issueMediaAssets.id, row.id), eq(issueMediaAssets.storageState, "STAGED")))
          .returning();
        if (!updated)
          throw new IssueMediaError("MEDIA_STATE_CONFLICT", 409, "Asset state changed.");
        await audit({
          memberId: input.memberId,
          eventType,
          outcome: "SUCCEEDED",
          requestId: input.requestId,
          metadata: { assetId: row.id },
        });
        return mapAsset(updated, storage);
      } catch (error) {
        await storage.purge([published.objectKey]).catch(() => undefined);
        throw error;
      }
    },

    async attachChoice(input) {
      const eventType = "OPS_ISSUE_MEDIA_ATTACH";
      if (!(await requireOperator(input.memberId, eventType, input.requestId))) return null;
      const row = await asset(input.assetId);
      if (
        row.storageState !== "PUBLISHED" ||
        row.moderationState !== "APPROVED" ||
        !["ASSERTED", "CLEARED"].includes(row.rightsState)
      ) {
        throw new IssueMediaError(
          "MEDIA_STATE_CONFLICT",
          409,
          "Only an approved published asset can be attached.",
        );
      }
      const [choice] = await database
        .select({
          id: issueChoices.id,
          lockedAt: issueVersions.lockedAt,
          publishedAt: issueVersions.publishedAt,
        })
        .from(issueChoices)
        .innerJoin(
          issueVersions,
          and(
            eq(issueVersions.issueId, issueChoices.issueId),
            eq(issueVersions.version, issueChoices.issueVersion),
          ),
        )
        .where(
          and(
            eq(issueChoices.issueId, input.issueId),
            eq(issueChoices.issueVersion, input.issueVersion),
            eq(issueChoices.id, input.choiceId),
          ),
        )
        .limit(1);
      if (!choice) {
        throw new IssueMediaError(
          "ISSUE_CHOICE_NOT_FOUND",
          404,
          "The target Issue choice was not found.",
        );
      }
      if (choice.lockedAt || choice.publishedAt) {
        throw new IssueMediaError(
          "ISSUE_VERSION_LOCKED",
          409,
          "Published or locked Issue versions cannot change media links in place.",
        );
      }
      const result = await database.transaction(async (transaction) => {
        const [previous] = await transaction
          .select({ assetId: issueChoiceMedia.mediaAssetId })
          .from(issueChoiceMedia)
          .where(
            and(
              eq(issueChoiceMedia.issueId, input.issueId),
              eq(issueChoiceMedia.issueVersion, input.issueVersion),
              eq(issueChoiceMedia.choiceId, input.choiceId),
            ),
          )
          .limit(1);
        await transaction
          .insert(issueChoiceMedia)
          .values({
            issueId: input.issueId,
            issueVersion: input.issueVersion,
            choiceId: input.choiceId,
            mediaAssetId: input.assetId,
            altText: input.altText.trim(),
            cropMode: input.cropMode,
            displayPosition: input.displayPosition,
            linkedByMemberId: input.memberId,
          })
          .onConflictDoUpdate({
            target: [
              issueChoiceMedia.issueId,
              issueChoiceMedia.issueVersion,
              issueChoiceMedia.choiceId,
            ],
            set: {
              mediaAssetId: input.assetId,
              altText: input.altText.trim(),
              cropMode: input.cropMode,
              displayPosition: input.displayPosition,
              linkedByMemberId: input.memberId,
              updatedAt: new Date(),
            },
          });
        const [count] = await transaction
          .select({ value: sql<number>`count(*)::int` })
          .from(issueChoiceMedia)
          .where(
            and(
              eq(issueChoiceMedia.issueId, input.issueId),
              eq(issueChoiceMedia.issueVersion, input.issueVersion),
            ),
          );
        if (count?.value === 2) {
          await transaction
            .update(issueVersions)
            .set({ mediaMode: "OPTION_IMAGES" })
            .where(
              and(
                eq(issueVersions.issueId, input.issueId),
                eq(issueVersions.version, input.issueVersion),
              ),
            );
        }
        return { previousAssetId: previous?.assetId ?? null };
      });
      if (result.previousAssetId && result.previousAssetId !== input.assetId) {
        const previous = await asset(result.previousAssetId);
        await quarantineStoredAsset(previous, "MODERATION_REVOKED");
      }
      await audit({
        memberId: input.memberId,
        eventType,
        outcome: "SUCCEEDED",
        requestId: input.requestId,
        metadata: { assetId: input.assetId, issueId: input.issueId, choiceId: input.choiceId },
      });
      return { attached: true, replacedAssetId: result.previousAssetId };
    },

    async detachChoice(input) {
      const eventType = "OPS_ISSUE_MEDIA_DETACH";
      if (!(await requireOperator(input.memberId, eventType, input.requestId))) return null;
      const [version] = await database
        .select({ lockedAt: issueVersions.lockedAt, publishedAt: issueVersions.publishedAt })
        .from(issueVersions)
        .where(
          and(
            eq(issueVersions.issueId, input.issueId),
            eq(issueVersions.version, input.issueVersion),
          ),
        )
        .limit(1);
      if (!version) {
        throw new IssueMediaError("ISSUE_CHOICE_NOT_FOUND", 404, "Issue version not found.");
      }
      if (version.lockedAt || version.publishedAt) {
        throw new IssueMediaError(
          "ISSUE_VERSION_LOCKED",
          409,
          "Published or locked Issue versions cannot change media links in place.",
        );
      }
      const removed = await database
        .delete(issueChoiceMedia)
        .where(
          and(
            eq(issueChoiceMedia.issueId, input.issueId),
            eq(issueChoiceMedia.issueVersion, input.issueVersion),
            eq(issueChoiceMedia.choiceId, input.choiceId),
          ),
        )
        .returning({ assetId: issueChoiceMedia.mediaAssetId });
      await database
        .update(issueVersions)
        .set({ mediaMode: "TEXT_ONLY" })
        .where(
          and(
            eq(issueVersions.issueId, input.issueId),
            eq(issueVersions.version, input.issueVersion),
          ),
        );
      await audit({
        memberId: input.memberId,
        eventType,
        outcome: "SUCCEEDED",
        requestId: input.requestId,
        metadata: { issueId: input.issueId, choiceId: input.choiceId },
      });
      return { detached: removed.length > 0 };
    },

    async quarantineAsset(input) {
      const eventType = "OPS_ISSUE_MEDIA_QUARANTINE";
      if (!(await requireOperator(input.memberId, eventType, input.requestId))) return null;
      const updated = await quarantineStoredAsset(await asset(input.assetId), input.reason);
      await audit({
        memberId: input.memberId,
        eventType,
        outcome: "SUCCEEDED",
        requestId: input.requestId,
        metadata: { assetId: input.assetId, reason: input.reason },
      });
      return mapAsset(updated, storage);
    },

    async purgeAsset(input) {
      const eventType = "OPS_ISSUE_MEDIA_PURGE";
      if (!(await requireOperator(input.memberId, eventType, input.requestId))) return null;
      const updated = await purgeStoredAsset(await asset(input.assetId), input.reason);
      await audit({
        memberId: input.memberId,
        eventType,
        outcome: "SUCCEEDED",
        requestId: input.requestId,
        metadata: { assetId: input.assetId, reason: input.reason },
      });
      return mapAsset(updated, storage);
    },

    async quarantineIssue(input) {
      const eventType = "OPS_ISSUE_MEDIA_QUARANTINE_ISSUE";
      if (!(await requireOperator(input.memberId, eventType, input.requestId))) return null;
      const rows = await database
        .select({ asset: issueMediaAssets })
        .from(issueChoiceMedia)
        .innerJoin(issueMediaAssets, eq(issueMediaAssets.id, issueChoiceMedia.mediaAssetId))
        .where(eq(issueChoiceMedia.issueId, input.issueId));
      let quarantined = 0;
      for (const { asset: candidate } of rows) {
        if (candidate.storageState === "PURGED") continue;
        const needsTransition =
          candidate.storageState !== "QUARANTINED" ||
          (input.reason === "RIGHTS_CHALLENGED" && candidate.rightsState !== "CHALLENGED");
        if (!needsTransition) continue;
        await quarantineStoredAsset(candidate, input.reason);
        quarantined += 1;
      }
      await audit({
        memberId: input.memberId,
        eventType,
        outcome: "SUCCEEDED",
        requestId: input.requestId,
        metadata: { issueId: input.issueId, reason: input.reason, quarantined },
      });
      return { quarantined };
    },

    async purgeIssue(input) {
      const eventType = "OPS_ISSUE_MEDIA_PURGE_ISSUE";
      if (!(await requireOperator(input.memberId, eventType, input.requestId))) return null;
      const rows = await database
        .select({ asset: issueMediaAssets })
        .from(issueChoiceMedia)
        .innerJoin(issueMediaAssets, eq(issueMediaAssets.id, issueChoiceMedia.mediaAssetId))
        .where(eq(issueChoiceMedia.issueId, input.issueId));
      let purged = 0;
      for (const { asset: candidate } of rows) {
        if (candidate.storageState === "PURGED") continue;
        await purgeStoredAsset(candidate, input.reason);
        purged += 1;
      }
      await audit({
        memberId: input.memberId,
        eventType,
        outcome: "SUCCEEDED",
        requestId: input.requestId,
        metadata: { issueId: input.issueId, reason: input.reason, purged },
      });
      return { purged };
    },

    async purgeOrphans(input) {
      const eventType = "OPS_ISSUE_MEDIA_ORPHAN_PURGE";
      if (!(await requireOperator(input.memberId, eventType, input.requestId))) return null;
      const cutoff = new Date(Date.now() - input.olderThanHours * 60 * 60 * 1000);
      const candidates = await database
        .select()
        .from(issueMediaAssets)
        .where(
          and(
            eq(issueMediaAssets.storageState, "STAGED"),
            lt(issueMediaAssets.createdAt, cutoff),
            sql`not exists (
              select 1 from issue_choice_media link
              where link.media_asset_id = ${issueMediaAssets.id}
            )`,
          ),
        );
      let purged = 0;
      for (const candidate of candidates) {
        await purgeStoredAsset(candidate, "ORPHAN_CLEANUP");
        purged += 1;
      }
      await audit({
        memberId: input.memberId,
        eventType,
        outcome: "SUCCEEDED",
        requestId: input.requestId,
        metadata: { purged, olderThanHours: input.olderThanHours },
      });
      return { purged };
    },
  };
}
