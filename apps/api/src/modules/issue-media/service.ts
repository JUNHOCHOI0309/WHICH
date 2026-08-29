import { randomUUID } from "node:crypto";

import { and, desc, eq, ilike, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  issueChoiceMedia,
  issueChoiceMediaRevisions,
  issueChoices,
  issueMediaAssets,
  issueMediaAssetVersions,
  issueMediaLibraryAssets,
  issueMediaLibraryPairs,
  issueMediaLibraryUsages,
  issueMediaKnownBlockHashes,
  issueMediaRuleFindings,
  issueMediaUploadSessions,
  issueVersions,
  members,
  operatorAccessGrants,
  operatorAuditLogs,
  outboxEvents,
} from "../../database/schema/index.js";

import type {
  IssueMediaAssetRecord,
  IssueMediaLibraryPair,
  IssueMediaObjectStorage,
  IssueMediaService,
  RegisterIssueMediaLibraryPair,
} from "./contracts.js";
import { sha256 } from "../content-revisions/service.js";
import { IssueMediaProcessingError, processIssueMedia } from "./image-processing.js";
import {
  evaluateLocalMediaInspection,
  ISSUE_MEDIA_RULE_POLICY_VERSION,
  unavailableLocalMediaSignalDetector,
  type IssueMediaRuleGateMode,
  type LocalMediaSignalDetector,
  type LocalMediaSignalDetectorResult,
} from "./upload-gate-policy.js";
import { createModerationSubmissionEvents } from "../moderation-dispatch/contracts.js";

export class IssueMediaError extends Error {
  constructor(
    public readonly code:
      | IssueMediaProcessingError["code"]
      | "MEDIA_DUPLICATE"
      | "MEDIA_KNOWN_BLOCK"
      | "MEDIA_NOT_FOUND"
      | "MEDIA_STATE_CONFLICT"
      | "MEDIA_RIGHTS_BLOCKED"
      | "ISSUE_CHOICE_NOT_FOUND"
      | "ISSUE_VERSION_LOCKED"
      | "MEDIA_STORAGE_UNAVAILABLE"
      | "MEDIA_REVIEW_TRANSITION_INVALID"
      | "RIGHTS_REQUEST_NOT_FOUND",
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
    sourceType: row.sourceType as IssueMediaAssetRecord["sourceType"],
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
  options: {
    ruleGateMode?: IssueMediaRuleGateMode;
    localSignalDetector?: LocalMediaSignalDetector;
  } = {},
): IssueMediaService {
  const ruleGateMode = options.ruleGateMode ?? "ENFORCE";
  const localSignalDetector = options.localSignalDetector ?? unavailableLocalMediaSignalDetector;

  async function appendChoiceMediaRevision(
    transaction: Parameters<Parameters<typeof database.transaction>[0]>[0],
    input: {
      issueId: string;
      issueVersion: number;
      choiceId: string;
      operation: "ATTACHED" | "REPLACED" | "DETACHED";
      mediaAssetId?: string;
      mediaSha256?: string;
      altText?: string;
      cropMode?: string;
      displayPosition?: number;
      rightsAttestation?: string;
      linkedByMemberId: string;
    },
  ) {
    const [latest] = await transaction
      .select({ revision: issueChoiceMediaRevisions.revision })
      .from(issueChoiceMediaRevisions)
      .where(
        and(
          eq(issueChoiceMediaRevisions.issueId, input.issueId),
          eq(issueChoiceMediaRevisions.issueVersion, input.issueVersion),
          eq(issueChoiceMediaRevisions.choiceId, input.choiceId),
        ),
      )
      .orderBy(sql`${issueChoiceMediaRevisions.revision} desc`)
      .limit(1);
    await transaction.insert(issueChoiceMediaRevisions).values({
      issueId: input.issueId,
      issueVersion: input.issueVersion,
      choiceId: input.choiceId,
      revision: (latest?.revision ?? 0) + 1,
      operation: input.operation,
      mediaAssetId: input.mediaAssetId,
      mediaAssetVersion: input.mediaAssetId ? 1 : undefined,
      mediaSha256: input.mediaSha256,
      altText: input.altText,
      cropMode: input.cropMode,
      displayPosition: input.displayPosition,
      rightsAttestation: input.rightsAttestation,
      linkedByMemberId: input.linkedByMemberId,
    });
  }

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

  function validateLibraryPair(input: RegisterIssueMediaLibraryPair) {
    const sides = input.assets
      .map((candidate) => candidate.side)
      .sort()
      .join("");
    const mediaIds = new Set(input.assets.map((candidate) => candidate.mediaAssetId));
    if (
      input.title.trim().length < 2 ||
      input.title.trim().length > 160 ||
      !input.categoryCode.trim() ||
      input.topics.length > 20 ||
      sides !== "AB" ||
      mediaIds.size !== 2
    ) {
      throw new IssueMediaError(
        "MEDIA_STATE_CONFLICT",
        422,
        "Library에는 서로 다른 A/B 승인 이미지를 한 쌍으로 등록해야 합니다.",
      );
    }
    for (const candidate of input.assets) {
      const acquiredAt = new Date(candidate.acquiredAt);
      const expiresAt = candidate.expiresAt ? new Date(candidate.expiresAt) : null;
      if (
        candidate.altText.trim().length < 2 ||
        candidate.evidenceReference.trim().length < 8 ||
        candidate.sourceUrl.trim().length < 8 ||
        !Number.isFinite(acquiredAt.getTime()) ||
        (expiresAt !== null &&
          (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())) ||
        !candidate.commercialAllowed ||
        !candidate.redistributionAllowed
      ) {
        throw new IssueMediaError(
          "MEDIA_RIGHTS_BLOCKED",
          422,
          "출처·라이선스 증빙과 상업적 이용·재배포 권한을 확인해 주세요.",
        );
      }
    }
  }

  async function loadLibraryPairs(input: {
    query?: string;
    categoryCode?: string;
    limit: number;
    pairId?: string;
  }): Promise<IssueMediaLibraryPair[]> {
    const now = new Date();
    const filters = [
      eq(issueMediaLibraryPairs.status, "PUBLISHED"),
      eq(issueMediaAssets.processingState, "READY"),
      eq(issueMediaAssets.moderationState, "APPROVED"),
      eq(issueMediaAssets.storageState, "PUBLISHED"),
      inArray(issueMediaAssets.rightsState, ["ASSERTED", "CLEARED"]),
      sql`${issueMediaAssets.publishedObjectKey} is not null`,
      or(
        isNull(issueMediaLibraryAssets.expiresAt),
        sql`${issueMediaLibraryAssets.expiresAt} > ${now}`,
      )!,
    ];
    if (input.pairId) filters.push(eq(issueMediaLibraryPairs.id, input.pairId));
    if (input.categoryCode)
      filters.push(eq(issueMediaLibraryPairs.categoryCode, input.categoryCode));
    if (input.query?.trim()) {
      const query = `%${input.query.trim()}%`;
      filters.push(
        or(
          ilike(issueMediaLibraryPairs.title, query),
          sql`${issueMediaLibraryPairs.topics}::text ilike ${query}`,
        )!,
      );
    }
    const rows = await database
      .select({
        pair: issueMediaLibraryPairs,
        libraryAsset: issueMediaLibraryAssets,
        mediaAsset: issueMediaAssets,
        usageCount: sql<number>`(
          select count(*)::int from issue_media_library_usages usage
          where usage.library_pair_id = ${issueMediaLibraryPairs.id}
            and usage.status = 'ACTIVE'
        )`,
      })
      .from(issueMediaLibraryPairs)
      .innerJoin(
        issueMediaLibraryAssets,
        eq(issueMediaLibraryAssets.pairId, issueMediaLibraryPairs.id),
      )
      .innerJoin(issueMediaAssets, eq(issueMediaAssets.id, issueMediaLibraryAssets.mediaAssetId))
      .where(and(...filters))
      .orderBy(desc(issueMediaLibraryPairs.createdAt), issueMediaLibraryAssets.side)
      .limit(Math.max(2, Math.min(input.limit, 100)) * 2);
    const pairs = new Map<string, IssueMediaLibraryPair>();
    for (const row of rows) {
      const current = pairs.get(row.pair.id) ?? {
        id: row.pair.id,
        title: row.pair.title,
        categoryCode: row.pair.categoryCode,
        topics: row.pair.topics,
        status: row.pair.status as IssueMediaLibraryPair["status"],
        assets: [],
        usageCount: row.usageCount,
        createdAt: row.pair.createdAt.toISOString(),
      };
      current.assets.push({
        id: row.libraryAsset.id,
        side: row.libraryAsset.side as "A" | "B",
        mediaAssetId: row.mediaAsset.id,
        url: storage.publicUrl(row.mediaAsset.publishedObjectKey!),
        altText: row.libraryAsset.altText,
        cropMode: row.libraryAsset.cropMode as "COVER" | "CONTAIN",
        width: row.mediaAsset.outputWidth,
        height: row.mediaAsset.outputHeight,
        attributionText: row.libraryAsset.attributionText,
      });
      pairs.set(row.pair.id, current);
    }
    return [...pairs.values()]
      .filter((pair) => pair.assets.length === 2)
      .slice(0, Math.max(1, Math.min(input.limit, 50)));
  }

  async function stageStoredAsset(input: {
    memberId: string;
    uploadSessionId?: string;
    sourceType: IssueMediaAssetRecord["sourceType"];
    rightsAttestation: string;
    declaredMimeType: IssueMediaAssetRecord["input"]["mimeType"];
    bytes: Buffer;
  }) {
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
    const normalizedSha256 = sha256(processed.body);
    let detector: LocalMediaSignalDetectorResult | undefined;
    if (input.sourceType === "MEMBER_SUBMISSION" && ruleGateMode !== "OFF") {
      detector = await localSignalDetector.inspect(processed.body).catch(() => ({
        detectorVersion: "which-local-signal-error-v1",
        qr: { status: "PARTIAL" as const, detected: false },
        barcode: { status: "PARTIAL" as const, detected: false },
        ocr: { status: "PARTIAL" as const },
        visual: {
          status: "PARTIAL" as const,
          faceDetected: false,
          identityDocumentDetected: false,
          screenshotDetected: false,
        },
      }));
    }
    const [knownBlock, similarAssets] = await Promise.all([
      database
        .select({
          sha256: issueMediaKnownBlockHashes.sha256,
          policyVersion: issueMediaKnownBlockHashes.policyVersion,
          reasonCode: issueMediaKnownBlockHashes.reasonCode,
        })
        .from(issueMediaKnownBlockHashes)
        .where(
          and(
            eq(issueMediaKnownBlockHashes.sha256, processed.sha256),
            eq(issueMediaKnownBlockHashes.active, true),
          ),
        )
        .limit(1),
      database
        .select({ perceptualHash: issueMediaAssets.perceptualHash })
        .from(issueMediaAssets)
        .where(ne(issueMediaAssets.storageState, "PURGED"))
        .orderBy(sql`${issueMediaAssets.createdAt} desc`)
        .limit(50),
    ]);
    const inspection = evaluateLocalMediaInspection({
      sha256: processed.sha256,
      perceptualHash: processed.perceptualHash,
      knownBlockedSha256: new Set(knownBlock.map((row) => row.sha256)),
      similarPerceptualHashes: similarAssets.map((row) => row.perceptualHash),
      detector,
      inspectionComplete:
        input.sourceType !== "MEMBER_SUBMISSION" ||
        Boolean(
          detector &&
          detector.qr.status === "COMPLETE" &&
          detector.barcode.status === "COMPLETE" &&
          detector.ocr.status === "COMPLETE" &&
          detector.visual.status === "COMPLETE",
        ),
    });
    const routeDecision =
      ruleGateMode === "ENFORCE"
        ? inspection.decision
        : input.sourceType === "MEMBER_SUBMISSION" && inspection.decision !== "REVIEW_READY"
          ? "REVIEW_REQUIRED"
          : inspection.decision;
    const findingEvidence = {
      sourceSha256: processed.sha256,
      normalizedSha256,
      policyVersion: ISSUE_MEDIA_RULE_POLICY_VERSION,
      ruleGateMode,
      detectorVersion: detector?.detectorVersion ?? null,
      processingRegion: "LOCAL",
    };
    const canonicalFindings = [
      {
        stage: "NORMALIZATION",
        code: "MEDIA_SOURCE_SIGNATURE_DECODE_VERIFIED",
        severity: "INFO" as const,
        sourceVersion: ISSUE_MEDIA_RULE_POLICY_VERSION,
        evidence: {
          ...findingEvidence,
          mimeType: processed.input.mimeType,
          byteSize: processed.input.byteSize,
          width: processed.input.width,
          height: processed.input.height,
        },
      },
      {
        stage: "NORMALIZATION",
        code: "MEDIA_NORMALIZED_WEBP_READY",
        severity: "INFO" as const,
        sourceVersion: ISSUE_MEDIA_RULE_POLICY_VERSION,
        evidence: {
          ...findingEvidence,
          mimeType: processed.output.mimeType,
          byteSize: processed.output.byteSize,
          width: processed.output.width,
          height: processed.output.height,
          exifRetained: false,
        },
      },
      {
        stage: "HASH",
        code: "MEDIA_HASHES_COMPUTED",
        severity: "INFO" as const,
        sourceVersion: ISSUE_MEDIA_RULE_POLICY_VERSION,
        evidence: { ...findingEvidence, perceptualHash: processed.perceptualHash },
      },
      ...inspection.signals.map((signal) => ({
        stage: "LOCAL_RULES",
        code: signal.code,
        severity: signal.severity,
        sourceVersion: signal.ruleVersion,
        evidence: {
          ...findingEvidence,
          ...(signal.code === "MEDIA_KNOWN_BLOCK_EXACT_HASH" && knownBlock[0]
            ? {
                knownBlockPolicyVersion: knownBlock[0].policyVersion,
                knownBlockReasonCode: knownBlock[0].reasonCode,
              }
            : {}),
          ...(signal.metadata ?? {}),
        },
      })),
      {
        stage: "ROUTING",
        code: `MEDIA_ROUTE_${routeDecision}`,
        severity:
          routeDecision === "AUTO_REJECT_PRIVATE"
            ? ("BLOCK" as const)
            : routeDecision === "REVIEW_REQUIRED"
              ? ("REVIEW" as const)
              : ("INFO" as const),
        sourceVersion: ISSUE_MEDIA_RULE_POLICY_VERSION,
        evidence: findingEvidence,
      },
    ];
    if (routeDecision === "AUTO_REJECT_PRIVATE") {
      if (input.uploadSessionId) {
        const uploadSessionId = input.uploadSessionId;
        await database.transaction(async (transaction) => {
          await transaction.insert(issueMediaRuleFindings).values(
            canonicalFindings.map((finding) => ({
              uploadSessionId,
              ...finding,
            })),
          );
          await transaction
            .update(issueMediaUploadSessions)
            .set({ state: "REJECTED", updatedAt: new Date() })
            .where(eq(issueMediaUploadSessions.id, uploadSessionId));
        });
      }
      throw new IssueMediaError(
        "MEDIA_KNOWN_BLOCK",
        422,
        "This image matches a verified private block entry and cannot be uploaded.",
      );
    }
    const [duplicate] = await database
      .select()
      .from(issueMediaAssets)
      .where(eq(issueMediaAssets.sha256, processed.sha256))
      .limit(1);
    if (duplicate) {
      if (
        input.sourceType === "MEMBER_SUBMISSION" &&
        duplicate.sourceType === "MEMBER_SUBMISSION" &&
        duplicate.uploadedByMemberId === input.memberId &&
        duplicate.storageState === "STAGED"
      ) {
        return mapAsset(duplicate, storage);
      }
      throw new IssueMediaError(
        "MEDIA_DUPLICATE",
        409,
        `This exact image already exists as asset ${duplicate.id}.`,
      );
    }
    const id = randomUUID();
    const staged = await storage.stage(id, processed.body);
    try {
      const created = await database.transaction(async (transaction) => {
        const rightsAttestedAt = new Date();
        const [assetRow] = await transaction
          .insert(issueMediaAssets)
          .values({
            id,
            uploadedByMemberId: input.memberId,
            sourceType: input.sourceType,
            rightsAttestation,
            rightsAttestedAt,
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
            stagedAt: rightsAttestedAt,
          })
          .returning();
        if (!assetRow) throw new Error("Media asset insert did not return a row.");
        await transaction.insert(issueMediaAssetVersions).values({
          assetId: id,
          version: 1,
          sourceType: input.sourceType,
          rightsAttestation,
          rightsAttestedAt,
          sha256: processed.sha256,
          perceptualHash: processed.perceptualHash,
          inputMimeType: processed.input.mimeType,
          inputByteSize: processed.input.byteSize,
          inputWidth: processed.input.width,
          inputHeight: processed.input.height,
          outputMimeType: processed.output.mimeType,
          outputByteSize: processed.output.byteSize,
          outputWidth: processed.output.width,
          outputHeight: processed.output.height,
          normalizedObjectRef: `issue-media://asset/${id}/version/1`,
          inputHash: normalizedSha256,
        });
        const moderationEvents = createModerationSubmissionEvents({
          targetType: "ISSUE_MEDIA_ASSET",
          targetId: id,
          targetVersion: 1,
          privateObjectReference: `issue-media://asset/${id}/version/1`,
          normalizedInputHash: normalizedSha256,
          reason: "CREATE",
          occurredAt: rightsAttestedAt,
        });
        await transaction.insert(outboxEvents).values(moderationEvents.rows);
        await transaction
          .insert(issueMediaRuleFindings)
          .values(canonicalFindings.map((finding) => ({ mediaAssetId: id, ...finding })));
        return assetRow;
      });
      return mapAsset(created, storage);
    } catch (error) {
      await storage.purge([staged.objectKey]).catch(() => undefined);
      throw error;
    }
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
    await database.transaction(async (transaction) => {
      const links = await transaction
        .delete(issueChoiceMedia)
        .where(eq(issueChoiceMedia.mediaAssetId, row.id))
        .returning({
          issueId: issueChoiceMedia.issueId,
          issueVersion: issueChoiceMedia.issueVersion,
          choiceId: issueChoiceMedia.choiceId,
          linkedByMemberId: issueChoiceMedia.linkedByMemberId,
        });
      for (const link of links) {
        await appendChoiceMediaRevision(transaction, {
          issueId: link.issueId,
          issueVersion: link.issueVersion,
          choiceId: link.choiceId,
          operation: "DETACHED",
          linkedByMemberId: link.linkedByMemberId,
        });
        await transaction
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
      return links;
    });
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
    async listLibraryPairs(input) {
      return { items: await loadLibraryPairs(input) };
    },

    async registerLibraryPair(input) {
      const eventType = "OPS_ISSUE_MEDIA_LIBRARY_REGISTER";
      if (!(await requireOperator(input.memberId, eventType, input.requestId))) return null;
      validateLibraryPair(input.pair);
      const mediaIds = input.pair.assets.map((candidate) => candidate.mediaAssetId);
      const media = await database
        .select()
        .from(issueMediaAssets)
        .where(inArray(issueMediaAssets.id, mediaIds));
      if (
        media.length !== 2 ||
        media.some(
          (candidate) =>
            candidate.sourceType !== "OPERATOR_UPLOAD" ||
            candidate.processingState !== "READY" ||
            candidate.moderationState !== "APPROVED" ||
            candidate.storageState !== "PUBLISHED" ||
            !["ASSERTED", "CLEARED"].includes(candidate.rightsState),
        )
      ) {
        throw new IssueMediaError(
          "MEDIA_STATE_CONFLICT",
          409,
          "검수 승인되어 공개 저장소에 있는 운영 이미지 두 장만 Library에 등록할 수 있습니다.",
        );
      }
      const pairId = randomUUID();
      await database.transaction(async (transaction) => {
        await transaction.insert(issueMediaLibraryPairs).values({
          id: pairId,
          title: input.pair.title.trim(),
          categoryCode: input.pair.categoryCode.trim(),
          topics: [...new Set(input.pair.topics.map((topic) => topic.trim()).filter(Boolean))],
          createdByMemberId: input.memberId,
        });
        await transaction.insert(issueMediaLibraryAssets).values(
          input.pair.assets.map((candidate) => ({
            pairId,
            side: candidate.side,
            mediaAssetId: candidate.mediaAssetId,
            altText: candidate.altText.trim(),
            cropMode: candidate.cropMode,
            sourceUrl: candidate.sourceUrl.trim(),
            authorName: candidate.authorName.trim(),
            licenseName: candidate.licenseName.trim(),
            licenseVersion: candidate.licenseVersion.trim(),
            acquiredAt: new Date(candidate.acquiredAt),
            commercialAllowed: candidate.commercialAllowed,
            derivativeAllowed: candidate.derivativeAllowed,
            redistributionAllowed: candidate.redistributionAllowed,
            attributionText: candidate.attributionText?.trim() || null,
            evidenceReference: candidate.evidenceReference.trim(),
            expiresAt: candidate.expiresAt ? new Date(candidate.expiresAt) : null,
          })),
        );
      });
      await audit({
        memberId: input.memberId,
        eventType,
        outcome: "SUCCEEDED",
        requestId: input.requestId,
        metadata: { pairId, mediaAssetIds: mediaIds },
      });
      return (await loadLibraryPairs({ pairId, limit: 1 }))[0]!;
    },

    async revokeLibraryPair(input) {
      const eventType = "OPS_ISSUE_MEDIA_LIBRARY_REVOKE";
      if (!(await requireOperator(input.memberId, eventType, input.requestId))) return null;
      const reason = input.reason.trim();
      if (reason.length < 10 || reason.length > 2000) {
        throw new IssueMediaError(
          "MEDIA_RIGHTS_BLOCKED",
          422,
          "Library 회수 근거를 10자 이상 입력해 주세요.",
        );
      }
      const [pair] = await database
        .select()
        .from(issueMediaLibraryPairs)
        .where(eq(issueMediaLibraryPairs.id, input.pairId))
        .limit(1);
      if (!pair) throw new IssueMediaError("MEDIA_NOT_FOUND", 404, "Library pair not found.");
      const linkedAssets = await database
        .select({ asset: issueMediaAssets })
        .from(issueMediaLibraryAssets)
        .innerJoin(issueMediaAssets, eq(issueMediaAssets.id, issueMediaLibraryAssets.mediaAssetId))
        .where(eq(issueMediaLibraryAssets.pairId, input.pairId));
      const [usageCount] = await database
        .select({ value: sql<number>`count(distinct ${issueMediaLibraryUsages.issueId})::int` })
        .from(issueMediaLibraryUsages)
        .where(
          and(
            eq(issueMediaLibraryUsages.pairId, input.pairId),
            eq(issueMediaLibraryUsages.status, "ACTIVE"),
          ),
        );
      if (pair.status !== "REVOKED") {
        await database.transaction(async (transaction) => {
          await transaction.execute(
            sql`delete from issue_choice_media choice_media
              where exists (
                select 1 from issue_media_library_usages usage
                where usage.library_pair_id = ${input.pairId}
                  and usage.status = 'ACTIVE'
                  and usage.issue_id = choice_media.issue_id
                  and usage.issue_version = choice_media.issue_version
              )`,
          );
          await transaction.execute(
            sql`update issue_versions version
              set media_mode = 'TEXT_ONLY'
              where exists (
                select 1 from issue_media_library_usages usage
                where usage.library_pair_id = ${input.pairId}
                  and usage.status = 'ACTIVE'
                  and usage.issue_id = version.issue_id
                  and usage.issue_version = version.issue_version
              )`,
          );
          await transaction
            .update(issueMediaLibraryUsages)
            .set({ status: "TEXT_FALLBACK", fallbackReason: reason, updatedAt: new Date() })
            .where(
              and(
                eq(issueMediaLibraryUsages.pairId, input.pairId),
                eq(issueMediaLibraryUsages.status, "ACTIVE"),
              ),
            );
          await transaction
            .update(issueMediaLibraryPairs)
            .set({
              status: "REVOKED",
              revokedByMemberId: input.memberId,
              revokeReason: reason,
              revokedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(issueMediaLibraryPairs.id, input.pairId));
        });
        for (const { asset: candidate } of linkedAssets) {
          if (candidate.storageState === "PUBLISHED") {
            await quarantineStoredAsset(candidate, "RIGHTS_CHALLENGED");
          }
        }
      }
      await audit({
        memberId: input.memberId,
        eventType,
        outcome: "SUCCEEDED",
        requestId: input.requestId,
        metadata: { pairId: input.pairId, fallbackIssueCount: usageCount?.value ?? 0 },
      });
      return { pairId: input.pairId, fallbackIssueCount: usageCount?.value ?? 0 };
    },

    async stageAsset(input) {
      const eventType = "OPS_ISSUE_MEDIA_STAGE";
      if (!(await requireOperator(input.memberId, eventType, input.requestId))) return null;
      try {
        const staged = await stageStoredAsset(input);
        await audit({
          memberId: input.memberId,
          eventType,
          outcome: "SUCCEEDED",
          requestId: input.requestId,
          metadata: { assetId: staged.id, sha256: staged.sha256 },
        });
        return staged;
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

    async stageMemberAsset(input) {
      return stageStoredAsset({ ...input, sourceType: "MEMBER_SUBMISSION" });
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
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${input.issueId}:${input.issueVersion}:${input.choiceId}`}, 0))`,
        );
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
        await appendChoiceMediaRevision(transaction, {
          issueId: input.issueId,
          issueVersion: input.issueVersion,
          choiceId: input.choiceId,
          operation: previous ? "REPLACED" : "ATTACHED",
          mediaAssetId: input.assetId,
          mediaSha256: row.sha256,
          altText: input.altText.trim(),
          cropMode: input.cropMode,
          displayPosition: input.displayPosition,
          rightsAttestation: row.rightsAttestation,
          linkedByMemberId: input.memberId,
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
      const removed = await database.transaction(async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${input.issueId}:${input.issueVersion}:${input.choiceId}`}, 0))`,
        );
        const rows = await transaction
          .delete(issueChoiceMedia)
          .where(
            and(
              eq(issueChoiceMedia.issueId, input.issueId),
              eq(issueChoiceMedia.issueVersion, input.issueVersion),
              eq(issueChoiceMedia.choiceId, input.choiceId),
            ),
          )
          .returning({ assetId: issueChoiceMedia.mediaAssetId });
        if (rows[0]) {
          await appendChoiceMediaRevision(transaction, {
            issueId: input.issueId,
            issueVersion: input.issueVersion,
            choiceId: input.choiceId,
            operation: "DETACHED",
            linkedByMemberId: input.memberId,
          });
        }
        await transaction
          .update(issueVersions)
          .set({ mediaMode: "TEXT_ONLY" })
          .where(
            and(
              eq(issueVersions.issueId, input.issueId),
              eq(issueVersions.version, input.issueVersion),
            ),
          );
        return rows;
      });
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
