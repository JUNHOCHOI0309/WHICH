import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Database } from "../../database/client.js";
import {
  issueChoiceMedia,
  issueChoices,
  issueMediaAssets,
  issueMediaReviewDecisions,
  issueMediaRightsRequests,
  issueMediaRuleFindings,
  issueVersions,
  members,
  memberModerationNotices,
  moderationAuditEvents,
  operatorAccessGrants,
  operatorAuditLogs,
} from "../../database/schema/index.js";

import type {
  IssueMediaAssetRecord,
  IssueMediaObjectStorage,
  IssueMediaService,
} from "./contracts.js";
import type {
  IssueMediaReviewAction,
  IssueMediaReviewAsset,
  IssueMediaReviewDecision,
  IssueMediaReviewPage,
  IssueMediaReviewService,
  IssueMediaReviewStatus,
  IssueMediaRightsRequest,
} from "./review-contracts.js";
import { IssueMediaError } from "./service.js";
import { reconcileReviewedIssueSubmissions } from "../issues/creation-service.js";

const POLICY_VERSION = "issue-media-review-v1";

function effectiveStatus(row: typeof issueMediaAssets.$inferSelect): IssueMediaReviewStatus {
  if (row.storageState === "PURGED") return "DELETED";
  if (row.storageState === "PUBLISHED" && row.moderationState === "APPROVED") return "APPROVED";
  if (row.storageState === "QUARANTINED" && row.moderationState === "REJECTED") {
    return "REJECTED";
  }
  if (row.storageState === "QUARANTINED") return "HIDDEN";
  return "PENDING";
}

function publicAsset(
  row: typeof issueMediaAssets.$inferSelect,
  storage: IssueMediaObjectStorage,
): IssueMediaAssetRecord {
  return {
    id: row.id,
    sourceType: "OPERATOR_UPLOAD",
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
      row.storageState === "PUBLISHED" &&
      row.moderationState === "APPROVED" &&
      row.publishedObjectKey
        ? storage.publicUrl(row.publishedObjectKey)
        : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createIssueMediaReviewService(
  database: Database["db"],
  storage: IssueMediaObjectStorage,
  foundation: IssueMediaService,
  options: { publishMemberSubmissions?: boolean } = {},
): IssueMediaReviewService {
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
    outcome: "ALLOWED" | "DENIED" | "SUCCEEDED" | "FAILED";
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

  async function requireOperator(memberId: string, eventType: string, requestId?: string) {
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

  async function assetRow(assetId: string) {
    const [row] = await database
      .select()
      .from(issueMediaAssets)
      .where(eq(issueMediaAssets.id, assetId))
      .limit(1);
    if (!row) throw new IssueMediaError("MEDIA_NOT_FOUND", 404, "The media asset was not found.");
    return row;
  }

  async function decisionRows(assetIds: string[]) {
    if (assetIds.length === 0) return [];
    return database
      .select({
        decision: issueMediaReviewDecisions,
        reviewedBy: members.displayName,
      })
      .from(issueMediaReviewDecisions)
      .innerJoin(members, eq(members.id, issueMediaReviewDecisions.reviewedByMemberId))
      .where(inArray(issueMediaReviewDecisions.mediaAssetId, assetIds))
      .orderBy(desc(issueMediaReviewDecisions.createdAt));
  }

  function mapDecision(input: {
    decision: typeof issueMediaReviewDecisions.$inferSelect;
    reviewedBy: string;
  }): IssueMediaReviewDecision {
    return {
      id: input.decision.id,
      scope: input.decision.scope as "ASSET" | "ISSUE",
      assetId: input.decision.mediaAssetId,
      issueId: input.decision.issueId,
      status: input.decision.status as IssueMediaReviewAction,
      reasonCode: input.decision.reasonCode,
      rationale: input.decision.rationale,
      policyVersion: input.decision.policyVersion,
      reviewedBy: input.reviewedBy,
      requestId: input.decision.requestId,
      createdAt: input.decision.createdAt.toISOString(),
    };
  }

  async function appendDecision(input: {
    memberId: string;
    scope: "ASSET" | "ISSUE";
    assetId?: string;
    issueId?: string;
    status: IssueMediaReviewAction;
    reasonCode: string;
    rationale: string;
    policyVersion: string;
    requestId: string;
  }) {
    const [created] = await database
      .insert(issueMediaReviewDecisions)
      .values({
        scope: input.scope,
        mediaAssetId: input.assetId,
        issueId: input.issueId,
        status: input.status,
        reasonCode: input.reasonCode,
        rationale: input.rationale,
        policyVersion: input.policyVersion || POLICY_VERSION,
        reviewedByMemberId: input.memberId,
        requestId: input.requestId,
      })
      .returning();
    const [reviewer] = await database
      .select({ displayName: members.displayName })
      .from(members)
      .where(eq(members.id, input.memberId));
    const affectedMembers =
      input.scope === "ASSET" && input.assetId
        ? await database
            .select({ memberId: issueMediaAssets.uploadedByMemberId })
            .from(issueMediaAssets)
            .where(eq(issueMediaAssets.id, input.assetId))
        : input.issueId
          ? await database
              .select({ memberId: issueMediaAssets.uploadedByMemberId })
              .from(issueChoiceMedia)
              .innerJoin(issueMediaAssets, eq(issueMediaAssets.id, issueChoiceMedia.mediaAssetId))
              .where(eq(issueChoiceMedia.issueId, input.issueId))
          : [];
    const targetId = input.assetId ?? input.issueId;
    if (created && targetId) {
      const summary =
        input.status === "APPROVED"
          ? "이미지 검수가 승인되었습니다."
          : input.status === "RESTORED"
            ? "재검토 결과 이미지가 복원되었습니다."
            : input.status === "REJECTED"
              ? "이미지 검수가 반려되었습니다."
              : input.status === "DELETED"
                ? "이미지가 삭제되었습니다."
                : "이미지가 공개 화면에서 숨김 처리되었습니다.";
      const nextStep = ["REJECTED", "HIDDEN", "DELETED"].includes(input.status)
        ? "내 Moderation에서 이유를 확인하고 사람 재검토 또는 권리 절차를 선택할 수 있습니다."
        : "질문 게시 상태는 이미지 상태와 별도로 계속 확인할 수 있습니다.";
      for (const affected of new Set(affectedMembers.map((member) => member.memberId))) {
        const [notice] = await database
          .insert(memberModerationNotices)
          .values({
            memberId: affected,
            targetType: input.scope === "ASSET" ? "ISSUE_MEDIA_ASSET" : "ISSUE_VERSION",
            targetId,
            policyVersion: input.policyVersion || POLICY_VERSION,
            reasonCode: input.reasonCode,
            actionType: input.status,
            summary,
            nextStep,
            effectiveAt: created.createdAt,
          })
          .returning({ id: memberModerationNotices.id });
        if (notice) {
          await database.insert(moderationAuditEvents).values({
            eventType: "MEMBER_NOTICE_RECORDED",
            entityType: "NOTICE",
            entityId: notice.id,
            actorType: "SYSTEM",
            metadata: { decisionId: created.id, targetId, status: input.status },
          });
        }
      }
    }
    if (
      options.publishMemberSubmissions &&
      input.assetId &&
      ["APPROVED", "RESTORED"].includes(input.status)
    ) {
      await reconcileReviewedIssueSubmissions(database, input.assetId);
    }
    return mapDecision({ decision: created!, reviewedBy: reviewer?.displayName ?? "OPERATOR" });
  }

  async function linkedAssetRows(issueId: string) {
    return database
      .select({ asset: issueMediaAssets })
      .from(issueChoiceMedia)
      .innerJoin(issueMediaAssets, eq(issueMediaAssets.id, issueChoiceMedia.mediaAssetId))
      .where(eq(issueChoiceMedia.issueId, issueId));
  }

  async function restoreRow(row: typeof issueMediaAssets.$inferSelect) {
    if (
      row.storageState !== "QUARANTINED" ||
      row.moderationState !== "REVOKED" ||
      !row.quarantinedObjectKey ||
      !["ASSERTED", "CLEARED"].includes(row.rightsState)
    ) {
      throw new IssueMediaError(
        "MEDIA_REVIEW_TRANSITION_INVALID",
        409,
        "Only a hidden asset with cleared rights can be restored.",
      );
    }
    const restored = await storage.restorePublished(row.id, row.quarantinedObjectKey);
    const [updated] = await database
      .update(issueMediaAssets)
      .set({
        storageState: "PUBLISHED",
        moderationState: "APPROVED",
        publishedObjectKey: restored.objectKey,
        quarantinedObjectKey: null,
        publishedAt: new Date(),
        quarantinedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(issueMediaAssets.id, row.id))
      .returning();
    return updated!;
  }

  async function reviewAssetRecord(assetId: string): Promise<IssueMediaReviewAsset> {
    const [joined] = await database
      .select({
        asset: issueMediaAssets,
        uploadedBy: members.displayName,
        issueId: issueChoiceMedia.issueId,
        issueVersion: issueChoiceMedia.issueVersion,
        choiceId: issueChoiceMedia.choiceId,
        altText: issueChoiceMedia.altText,
        choiceCode: issueChoices.code,
        choiceLabel: issueChoices.label,
        question: issueVersions.question,
      })
      .from(issueMediaAssets)
      .innerJoin(members, eq(members.id, issueMediaAssets.uploadedByMemberId))
      .leftJoin(issueChoiceMedia, eq(issueChoiceMedia.mediaAssetId, issueMediaAssets.id))
      .leftJoin(
        issueChoices,
        and(
          eq(issueChoices.issueId, issueChoiceMedia.issueId),
          eq(issueChoices.issueVersion, issueChoiceMedia.issueVersion),
          eq(issueChoices.id, issueChoiceMedia.choiceId),
        ),
      )
      .leftJoin(
        issueVersions,
        and(
          eq(issueVersions.issueId, issueChoiceMedia.issueId),
          eq(issueVersions.version, issueChoiceMedia.issueVersion),
        ),
      )
      .where(eq(issueMediaAssets.id, assetId))
      .limit(1);
    if (!joined) throw new IssueMediaError("MEDIA_NOT_FOUND", 404, "Media asset not found.");
    const history = (await decisionRows([assetId])).map(mapDecision);
    const findings = await database
      .select({
        id: issueMediaRuleFindings.id,
        stage: issueMediaRuleFindings.stage,
        code: issueMediaRuleFindings.code,
        severity: issueMediaRuleFindings.severity,
        sourceVersion: issueMediaRuleFindings.sourceVersion,
        evidence: issueMediaRuleFindings.evidence,
        createdAt: issueMediaRuleFindings.createdAt,
      })
      .from(issueMediaRuleFindings)
      .where(eq(issueMediaRuleFindings.mediaAssetId, assetId))
      .orderBy(issueMediaRuleFindings.createdAt, issueMediaRuleFindings.id);
    return {
      ...publicAsset(joined.asset, storage),
      effectiveStatus: effectiveStatus(joined.asset),
      rightsAttestation: joined.asset.rightsAttestation,
      rightsAttestedAt: joined.asset.rightsAttestedAt.toISOString(),
      uploadedBy: joined.uploadedBy,
      link:
        joined.issueId &&
        joined.issueVersion &&
        joined.choiceId &&
        joined.choiceCode &&
        joined.choiceLabel &&
        joined.question &&
        joined.altText
          ? {
              issueId: joined.issueId,
              issueVersion: joined.issueVersion,
              choiceId: joined.choiceId,
              choiceCode: joined.choiceCode,
              choiceLabel: joined.choiceLabel,
              question: joined.question,
              altText: joined.altText,
            }
          : null,
      latestDecision: history[0] ?? null,
      history,
      findings: findings.map((finding) => ({
        ...finding,
        severity: finding.severity as "INFO" | "REVIEW" | "BLOCK",
        evidence: finding.evidence ?? {},
        createdAt: finding.createdAt.toISOString(),
      })),
    };
  }

  async function performAssetDecision(input: {
    memberId: string;
    assetId: string;
    status: IssueMediaReviewAction;
    reasonCode: string;
    rationale: string;
    policyVersion: string;
    requestId: string;
  }) {
    const row = await assetRow(input.assetId);
    if (input.status === "APPROVED") {
      if (effectiveStatus(row) !== "PENDING") {
        throw new IssueMediaError(
          "MEDIA_REVIEW_TRANSITION_INVALID",
          409,
          "Only pending assets can be approved.",
        );
      }
      await foundation.approveAndPublish(input);
    } else if (input.status === "REJECTED") {
      if (effectiveStatus(row) !== "PENDING") {
        throw new IssueMediaError(
          "MEDIA_REVIEW_TRANSITION_INVALID",
          409,
          "Only pending assets can be rejected.",
        );
      }
      await foundation.quarantineAsset({ ...input, reason: "MODERATION_REVOKED" });
      await database
        .update(issueMediaAssets)
        .set({ moderationState: "REJECTED", updatedAt: new Date() })
        .where(eq(issueMediaAssets.id, input.assetId));
    } else if (input.status === "HIDDEN") {
      if (effectiveStatus(row) === "DELETED") {
        throw new IssueMediaError(
          "MEDIA_REVIEW_TRANSITION_INVALID",
          409,
          "Deleted assets cannot be hidden.",
        );
      }
      await foundation.quarantineAsset({ ...input, reason: "MODERATION_REVOKED" });
      await database
        .update(issueMediaAssets)
        .set({ moderationState: "REVOKED", updatedAt: new Date() })
        .where(eq(issueMediaAssets.id, input.assetId));
    } else if (input.status === "DELETED") {
      await foundation.purgeAsset({ ...input, reason: "ISSUE_DELETED" });
    } else {
      await restoreRow(row);
    }
    return appendDecision({ ...input, scope: "ASSET" });
  }

  async function rightsRequests(input: {
    memberId: string;
    status?: "OPEN" | "ACTIONED" | "DISMISSED";
    limit: number;
    requestId?: string;
    auditRead?: boolean;
  }) {
    const recordedBy = alias(members, "rights_recorded_by");
    const resolvedBy = alias(members, "rights_resolved_by");
    const rows = await database
      .select({
        request: issueMediaRightsRequests,
        recordedBy: recordedBy.displayName,
        resolvedBy: resolvedBy.displayName,
      })
      .from(issueMediaRightsRequests)
      .innerJoin(recordedBy, eq(recordedBy.id, issueMediaRightsRequests.recordedByMemberId))
      .leftJoin(resolvedBy, eq(resolvedBy.id, issueMediaRightsRequests.resolvedByMemberId))
      .where(input.status ? eq(issueMediaRightsRequests.status, input.status) : undefined)
      .orderBy(desc(issueMediaRightsRequests.createdAt))
      .limit(input.limit);
    if (input.auditRead !== false) {
      await audit({
        memberId: input.memberId,
        eventType: "OPS_ISSUE_MEDIA_RIGHTS_LIST",
        outcome: "ALLOWED",
        requestId: input.requestId,
        metadata: { count: rows.length },
      });
    }
    return rows.map(
      ({ request, recordedBy: recorder, resolvedBy: resolver }): IssueMediaRightsRequest => ({
        id: request.id,
        requestType: request.requestType as IssueMediaRightsRequest["requestType"],
        assetId: request.mediaAssetId,
        issueId: request.issueId,
        requesterReference: request.requesterReference,
        details: request.details,
        status: request.status as IssueMediaRightsRequest["status"],
        resolution: request.resolution,
        actionDecisionId: request.actionDecisionId,
        recordedBy: recorder,
        resolvedBy: resolver,
        createdAt: request.createdAt.toISOString(),
        resolvedAt: request.resolvedAt?.toISOString() ?? null,
      }),
    );
  }

  return {
    async readAssets(input) {
      const eventType = "OPS_ISSUE_MEDIA_REVIEW_LIST";
      if (!(await requireOperator(input.memberId, eventType, input.requestId))) return null;
      const conditions = [];
      if (input.query) {
        const pattern = `%${input.query}%`;
        conditions.push(
          or(
            sql`${issueMediaAssets.id}::text ilike ${pattern}`,
            ilike(issueMediaAssets.sha256, pattern),
            ilike(issueMediaAssets.rightsAttestation, pattern),
          )!,
        );
      }
      const rows = await database
        .select({ id: issueMediaAssets.id })
        .from(issueMediaAssets)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(issueMediaAssets.createdAt))
        .limit(Math.min(input.limit * 5, 250));
      const records = await Promise.all(rows.map((row) => reviewAssetRecord(row.id)));
      const items = records
        .filter((record) => !input.status || record.effectiveStatus === input.status)
        .slice(0, input.limit);
      const countRows = await database.select({ asset: issueMediaAssets }).from(issueMediaAssets);
      const counts: IssueMediaReviewPage["counts"] = {
        PENDING: 0,
        APPROVED: 0,
        REJECTED: 0,
        HIDDEN: 0,
        DELETED: 0,
      };
      for (const row of countRows) counts[effectiveStatus(row.asset)] += 1;
      await audit({
        memberId: input.memberId,
        eventType,
        outcome: "ALLOWED",
        requestId: input.requestId,
        metadata: { count: items.length, status: input.status ?? "ALL" },
      });
      return { schemaVersion: 1, generatedAt: new Date().toISOString(), counts, items };
    },

    async readAssetContent(input) {
      const eventType = "OPS_ISSUE_MEDIA_CONTENT_READ";
      if (!(await requireOperator(input.memberId, eventType, input.requestId))) return null;
      const row = await assetRow(input.assetId);
      const key = row.publishedObjectKey ?? row.stagingObjectKey ?? row.quarantinedObjectKey;
      if (!key || row.storageState === "PURGED") {
        throw new IssueMediaError("MEDIA_NOT_FOUND", 404, "The media object is unavailable.");
      }
      const body = await storage.read(key);
      await audit({
        memberId: input.memberId,
        eventType,
        outcome: "ALLOWED",
        requestId: input.requestId,
        metadata: { assetId: input.assetId },
      });
      return body;
    },

    async decideAsset(input) {
      const eventType = "OPS_ISSUE_MEDIA_REVIEW_DECIDE";
      if (!(await requireOperator(input.memberId, eventType, input.requestId))) return null;
      try {
        const decision = await performAssetDecision(input);
        await audit({
          memberId: input.memberId,
          eventType,
          outcome: "SUCCEEDED",
          requestId: input.requestId,
          metadata: {
            assetId: input.assetId,
            status: input.status,
            reasonCode: input.reasonCode,
            decisionId: decision.id,
          },
        });
        return reviewAssetRecord(input.assetId);
      } catch (error) {
        await audit({
          memberId: input.memberId,
          eventType,
          outcome: "FAILED",
          requestId: input.requestId,
          metadata: {
            assetId: input.assetId,
            status: input.status,
            reasonCode: input.reasonCode,
            error: error instanceof IssueMediaError ? error.code : "UNEXPECTED_ERROR",
          },
        });
        throw error;
      }
    },

    async decideIssue(input) {
      const eventType = "OPS_ISSUE_MEDIA_REVIEW_DECIDE_ISSUE";
      if (!(await requireOperator(input.memberId, eventType, input.requestId))) return null;
      const rows = await linkedAssetRows(input.issueId);
      if (rows.length === 0)
        throw new IssueMediaError("MEDIA_NOT_FOUND", 404, "The Issue has no linked media assets.");
      let affected = 0;
      if (input.status === "HIDDEN") {
        affected =
          (await foundation.quarantineIssue({ ...input, reason: "ISSUE_BLINDED" }))?.quarantined ??
          0;
      } else if (input.status === "DELETED") {
        affected =
          (await foundation.purgeIssue({ ...input, reason: "ISSUE_DELETED" }))?.purged ?? 0;
      } else {
        for (const { asset } of rows) {
          if (asset.storageState !== "QUARANTINED") continue;
          await restoreRow(asset);
          affected += 1;
        }
      }
      const decision = await appendDecision({ ...input, scope: "ISSUE" });
      await audit({
        memberId: input.memberId,
        eventType,
        outcome: "SUCCEEDED",
        requestId: input.requestId,
        metadata: {
          issueId: input.issueId,
          status: input.status,
          reasonCode: input.reasonCode,
          affected,
          decisionId: decision.id,
        },
      });
      return { affected, decision };
    },

    async readRightsRequests(input) {
      const eventType = "OPS_ISSUE_MEDIA_RIGHTS_LIST";
      if (!(await requireOperator(input.memberId, eventType, input.requestId))) return null;
      return rightsRequests(input);
    },

    async createRightsRequest(input) {
      const eventType = "OPS_ISSUE_MEDIA_RIGHTS_CREATE";
      if (!(await requireOperator(input.memberId, eventType, input.requestId))) return null;
      if (!input.assetId && !input.issueId) {
        throw new IssueMediaError(
          "MEDIA_NOT_FOUND",
          404,
          "A media asset or Issue target is required.",
        );
      }
      let decision: IssueMediaReviewDecision;
      if (input.assetId) {
        await assetRow(input.assetId);
        await foundation.quarantineAsset({
          memberId: input.memberId,
          assetId: input.assetId,
          reason: "RIGHTS_CHALLENGED",
          requestId: input.requestId,
        });
        await database
          .update(issueMediaAssets)
          .set({ moderationState: "REVOKED", updatedAt: new Date() })
          .where(eq(issueMediaAssets.id, input.assetId));
        decision = await appendDecision({
          memberId: input.memberId,
          scope: "ASSET",
          assetId: input.assetId,
          status: "HIDDEN",
          reasonCode: `RIGHTS_${input.requestType}`,
          rationale: input.details,
          policyVersion: input.policyVersion,
          requestId: input.requestId,
        });
      } else {
        const rows = await linkedAssetRows(input.issueId!);
        if (rows.length === 0)
          throw new IssueMediaError(
            "MEDIA_NOT_FOUND",
            404,
            "The Issue has no linked media assets.",
          );
        await foundation.quarantineIssue({
          memberId: input.memberId,
          issueId: input.issueId!,
          reason: "RIGHTS_CHALLENGED",
          requestId: input.requestId,
        });
        const linked = await linkedAssetRows(input.issueId!);
        const linkedIds = linked.map(({ asset }) => asset.id);
        if (linkedIds.length) {
          await database
            .update(issueMediaAssets)
            .set({ moderationState: "REVOKED", updatedAt: new Date() })
            .where(inArray(issueMediaAssets.id, linkedIds));
        }
        decision = await appendDecision({
          memberId: input.memberId,
          scope: "ISSUE",
          issueId: input.issueId,
          status: "HIDDEN",
          reasonCode: `RIGHTS_${input.requestType}`,
          rationale: input.details,
          policyVersion: input.policyVersion,
          requestId: input.requestId,
        });
      }
      const [created] = await database
        .insert(issueMediaRightsRequests)
        .values({
          requestType: input.requestType,
          mediaAssetId: input.assetId,
          issueId: input.issueId,
          requesterReference: input.requesterReference,
          details: input.details,
          actionDecisionId: decision.id,
          recordedByMemberId: input.memberId,
          requestId: input.requestId,
        })
        .returning();
      await audit({
        memberId: input.memberId,
        eventType,
        outcome: "SUCCEEDED",
        requestId: input.requestId,
        metadata: {
          rightsRequestId: created!.id,
          type: input.requestType,
          decisionId: decision.id,
        },
      });
      const list = await rightsRequests({
        memberId: input.memberId,
        status: "OPEN",
        limit: 100,
        requestId: `${input.requestId}:readback`,
        auditRead: false,
      });
      return list.find((item) => item.id === created!.id) ?? null;
    },

    async resolveRightsRequest(input) {
      const eventType = "OPS_ISSUE_MEDIA_RIGHTS_RESOLVE";
      if (!(await requireOperator(input.memberId, eventType, input.requestId))) return null;
      const [current] = await database
        .select()
        .from(issueMediaRightsRequests)
        .where(eq(issueMediaRightsRequests.id, input.requestIdValue))
        .limit(1);
      if (!current)
        throw new IssueMediaError("RIGHTS_REQUEST_NOT_FOUND", 404, "Rights request not found.");
      if (current.status !== "OPEN")
        throw new IssueMediaError(
          "MEDIA_REVIEW_TRANSITION_INVALID",
          409,
          "The rights request is already resolved.",
        );
      if (input.status === "DISMISSED") {
        if (current.mediaAssetId) {
          await database
            .update(issueMediaAssets)
            .set({ rightsState: "CLEARED", updatedAt: new Date() })
            .where(
              and(
                eq(issueMediaAssets.id, current.mediaAssetId),
                eq(issueMediaAssets.rightsState, "CHALLENGED"),
              ),
            );
        }
        if (current.issueId) {
          const rows = await linkedAssetRows(current.issueId);
          const ids = rows.map(({ asset }) => asset.id);
          if (ids.length)
            await database
              .update(issueMediaAssets)
              .set({ rightsState: "CLEARED", updatedAt: new Date() })
              .where(
                and(
                  inArray(issueMediaAssets.id, ids),
                  eq(issueMediaAssets.rightsState, "CHALLENGED"),
                ),
              );
        }
      }
      await database
        .update(issueMediaRightsRequests)
        .set({
          status: input.status,
          resolution: input.resolution,
          resolvedByMemberId: input.memberId,
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(issueMediaRightsRequests.id, current.id));
      await audit({
        memberId: input.memberId,
        eventType,
        outcome: "SUCCEEDED",
        requestId: input.requestId,
        metadata: {
          rightsRequestId: current.id,
          status: input.status,
          actionDecisionId: current.actionDecisionId,
        },
      });
      const list = await rightsRequests({
        memberId: input.memberId,
        status: input.status,
        limit: 100,
        requestId: `${input.requestId}:readback`,
        auditRead: false,
      });
      return list.find((item) => item.id === current.id) ?? null;
    },
  };
}
