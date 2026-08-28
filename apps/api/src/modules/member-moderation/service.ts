import { createHash, randomUUID } from "node:crypto";

import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  comments,
  issueAuthors,
  issueMediaAssets,
  issueMediaReviewDecisions,
  issueVersions,
  memberIssueSubmissionRevisions,
  memberIssueSubmissions,
  memberModerationNotices,
  moderationAppeals,
  moderationAuditEvents,
  moderationCases,
  moderationRightsCases,
  moderationTargets,
  voterSubjects,
} from "../../database/schema/index.js";
import { createModerationOperationsService } from "../moderation-operations/service.js";

import type {
  MemberModerationAppeal,
  MemberModerationAsset,
  MemberModerationCenter,
  MemberModerationNotice,
  MemberModerationRightsCase,
  MemberModerationService,
  MemberModerationTargetType,
} from "./contracts.js";

export class MemberModerationError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

function appealView(row: typeof moderationAppeals.$inferSelect): MemberModerationAppeal {
  return {
    id: row.id,
    targetType: row.targetType as MemberModerationTargetType,
    targetId: row.targetId,
    reason: row.reason,
    status: row.status as MemberModerationAppeal["status"],
    resolution: row.resolution,
    submittedAt: row.submittedAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function rightsView(row: typeof moderationRightsCases.$inferSelect): MemberModerationRightsCase {
  return {
    id: row.id,
    requestType: row.requestType as MemberModerationRightsCase["requestType"],
    targetType: row.targetType as MemberModerationTargetType,
    targetId: row.targetId,
    details: row.details,
    status: row.status as MemberModerationRightsCase["status"],
    resolution: row.resolution,
    legalHoldUntil: row.legalHoldUntil?.toISOString() ?? null,
    dueAt: row.dueAt?.toISOString() ?? null,
    submittedAt: row.submittedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function noticeView(row: typeof memberModerationNotices.$inferSelect): MemberModerationNotice {
  return {
    id: row.id,
    targetType: row.targetType as MemberModerationTargetType,
    targetId: row.targetId,
    policyVersion: row.policyVersion,
    reasonCode: row.reasonCode,
    actionType: row.actionType,
    summary: row.summary,
    nextStep: row.nextStep,
    effectiveAt: row.effectiveAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function contentHash(input: {
  question: string;
  context: string | null;
  choiceA: string;
  choiceB: string;
  mediaAssetAId: string | null;
  mediaAssetBId: string | null;
  interestCardCode: string;
}) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function alternativeNotice(action: string) {
  if (action === "TEXT_ONLY") return "이미지를 제외하고 Text-only 질문으로 계속 검토됩니다.";
  if (action === "APPROVED_LIBRARY") return "승인된 Library 이미지로 교체해 다시 검토합니다.";
  if (action === "REPLACE_IMAGE") return "새 이미지가 별도 검수 대상으로 제출되었습니다.";
  return "대기 중인 이미지를 질문에서 제외했습니다.";
}

function rightsSchedule(requestType: MemberModerationRightsCase["requestType"], now = new Date()) {
  const dueDays = requestType === "PRIVACY" ? 14 : requestType === "DEFAMATION" ? 21 : 30;
  const legalHoldDays = requestType === "PRIVACY" ? null : 180;
  return {
    dueAt: new Date(now.getTime() + dueDays * 24 * 60 * 60 * 1_000),
    legalHoldUntil:
      legalHoldDays === null
        ? null
        : new Date(now.getTime() + legalHoldDays * 24 * 60 * 60 * 1_000),
  };
}

export function createMemberModerationService(
  database: Database["db"],
  options: { publicUrl?: (objectKey: string) => string } = {},
): MemberModerationService {
  const operations = createModerationOperationsService(database);

  async function ensureRegisteredTarget(input: {
    targetType: MemberModerationTargetType;
    targetId: string;
    version: number;
    hash: string;
    snapshot: string;
  }) {
    const [existing] = await database
      .select({ id: moderationTargets.id })
      .from(moderationTargets)
      .where(
        and(
          eq(moderationTargets.targetType, input.targetType),
          eq(moderationTargets.targetId, input.targetId),
          eq(moderationTargets.targetVersion, input.version),
        ),
      )
      .limit(1);
    if (existing) return existing;
    return operations.registerTarget({
      targetType: input.targetType,
      targetId: input.targetId,
      targetVersion: input.version,
      inputHash: input.hash,
      snapshotReference: input.snapshot,
    });
  }

  async function ensureOpenCase(input: {
    targetId: string;
    riskLane: "HIGH" | "RIGHTS";
    priority: "P0" | "P1";
    slaDueAt?: Date;
  }) {
    const [existing] = await database
      .select({ id: moderationCases.id })
      .from(moderationCases)
      .where(
        and(
          eq(moderationCases.targetId, input.targetId),
          inArray(moderationCases.status, ["OPEN", "TRIAGED", "IN_REVIEW"]),
        ),
      )
      .orderBy(desc(moderationCases.createdAt))
      .limit(1);
    if (existing) return existing;
    return operations.openCase(input);
  }

  async function assertOwnedTarget(
    memberId: string,
    targetType: MemberModerationTargetType,
    targetId: string,
  ) {
    if (targetType === "COMMENT_VERSION") {
      const [comment] = await database
        .select({
          version: comments.version,
          body: comments.body,
          bodyRevision: comments.bodyRevision,
        })
        .from(comments)
        .innerJoin(voterSubjects, eq(voterSubjects.id, comments.authorSubjectId))
        .where(and(eq(comments.id, targetId), eq(voterSubjects.userId, memberId)))
        .limit(1);
      if (!comment) throw new MemberModerationError("TARGET_NOT_FOUND", 404, "내 댓글이 아닙니다.");
      return {
        version: comment.version,
        hash: createHash("sha256").update(`${comment.bodyRevision}:${comment.body}`).digest("hex"),
        snapshot: `db://comment/${targetId}/${comment.version}`,
      };
    }
    if (targetType === "ISSUE_MEDIA_ASSET") {
      const [asset] = await database
        .select()
        .from(issueMediaAssets)
        .where(
          and(eq(issueMediaAssets.id, targetId), eq(issueMediaAssets.uploadedByMemberId, memberId)),
        )
        .limit(1);
      if (!asset) throw new MemberModerationError("TARGET_NOT_FOUND", 404, "내 이미지가 아닙니다.");
      return {
        version: 1,
        hash: asset.sha256,
        snapshot: `r2://${asset.storageState.toLowerCase()}/${asset.stagingObjectKey ?? asset.publishedObjectKey ?? asset.quarantinedObjectKey ?? asset.id}`,
      };
    }
    if (targetType === "ISSUE_VERSION") {
      const [issue] = await database
        .select({ version: issueVersions.version, hash: issueVersions.contentHash })
        .from(issueVersions)
        .innerJoin(issueAuthors, eq(issueAuthors.issueId, issueVersions.issueId))
        .where(and(eq(issueVersions.issueId, targetId), eq(issueAuthors.memberId, memberId)))
        .orderBy(desc(issueVersions.version))
        .limit(1);
      if (!issue) throw new MemberModerationError("TARGET_NOT_FOUND", 404, "내 질문이 아닙니다.");
      return {
        version: issue.version,
        hash: issue.hash,
        snapshot: `db://issue/${targetId}/${issue.version}`,
      };
    }
    if (targetType === "PROFILE_VERSION" && targetId === memberId) {
      return {
        version: 1,
        hash: createHash("sha256").update(`profile:${memberId}`).digest("hex"),
        snapshot: `db://profile/${memberId}/1`,
      };
    }
    throw new MemberModerationError(
      "TARGET_NOT_SUPPORTED",
      422,
      "이 대상은 현재 사용자 재검토 접수를 지원하지 않습니다.",
    );
  }

  async function appendNotice(input: {
    memberId: string;
    targetType: MemberModerationTargetType;
    targetId: string;
    reasonCode: string;
    actionType: string;
    summary: string;
    nextStep: string;
  }) {
    const [notice] = await database
      .insert(memberModerationNotices)
      .values({
        ...input,
        policyVersion: "member-moderation-v1",
        effectiveAt: new Date(),
      })
      .returning({ id: memberModerationNotices.id });
    if (notice) {
      await database.insert(moderationAuditEvents).values({
        eventType: "MEMBER_NOTICE_RECORDED",
        entityType: "NOTICE",
        entityId: notice.id,
        actorType: "SYSTEM",
        metadata: { targetType: input.targetType, targetId: input.targetId },
      });
    }
  }

  return {
    async readCenter(memberId): Promise<MemberModerationCenter> {
      const assets = await database
        .select()
        .from(issueMediaAssets)
        .where(eq(issueMediaAssets.uploadedByMemberId, memberId))
        .orderBy(desc(issueMediaAssets.updatedAt))
        .limit(50);
      const assetIds = assets.map((asset) => asset.id);
      const [submissions, decisions, notices, appeals, rightsCases, libraryAssets] =
        await Promise.all([
          assetIds.length
            ? database
                .select()
                .from(memberIssueSubmissions)
                .where(
                  and(
                    eq(memberIssueSubmissions.memberId, memberId),
                    or(
                      inArray(memberIssueSubmissions.mediaAssetAId, assetIds),
                      inArray(memberIssueSubmissions.mediaAssetBId, assetIds),
                    ),
                  ),
                )
            : Promise.resolve([]),
          assetIds.length
            ? database
                .select()
                .from(issueMediaReviewDecisions)
                .where(inArray(issueMediaReviewDecisions.mediaAssetId, assetIds))
                .orderBy(desc(issueMediaReviewDecisions.createdAt))
            : Promise.resolve([]),
          database
            .select()
            .from(memberModerationNotices)
            .where(eq(memberModerationNotices.memberId, memberId))
            .orderBy(desc(memberModerationNotices.createdAt))
            .limit(100),
          database
            .select()
            .from(moderationAppeals)
            .where(eq(moderationAppeals.memberId, memberId))
            .orderBy(desc(moderationAppeals.submittedAt))
            .limit(50),
          database
            .select()
            .from(moderationRightsCases)
            .where(eq(moderationRightsCases.memberId, memberId))
            .orderBy(desc(moderationRightsCases.submittedAt))
            .limit(50),
          options.publicUrl
            ? database
                .select({ id: issueMediaAssets.id, objectKey: issueMediaAssets.publishedObjectKey })
                .from(issueMediaAssets)
                .where(
                  and(
                    eq(issueMediaAssets.sourceType, "OPERATOR_UPLOAD"),
                    eq(issueMediaAssets.moderationState, "APPROVED"),
                    eq(issueMediaAssets.storageState, "PUBLISHED"),
                  ),
                )
                .orderBy(desc(issueMediaAssets.publishedAt))
                .limit(20)
            : Promise.resolve([]),
        ]);
      const latestDecision = new Map<string, (typeof decisions)[number]>();
      for (const decision of decisions) {
        if (decision.mediaAssetId && !latestDecision.has(decision.mediaAssetId)) {
          latestDecision.set(decision.mediaAssetId, decision);
        }
      }
      const activeAppeal = new Map(
        appeals
          .filter((appeal) => ["SUBMITTED", "IN_REVIEW"].includes(appeal.status))
          .map((appeal) => [appeal.targetId, appeal.id]),
      );
      const assetViews: MemberModerationAsset[] = assets.map((asset) => {
        const submission = submissions.find(
          (item) => item.mediaAssetAId === asset.id || item.mediaAssetBId === asset.id,
        );
        const decision = latestDecision.get(asset.id);
        const status: MemberModerationAsset["assetReview"]["status"] =
          asset.storageState === "PURGED"
            ? "DELETED"
            : asset.storageState === "PUBLISHED" && asset.moderationState === "APPROVED"
              ? "APPROVED"
              : asset.storageState === "QUARANTINED" && asset.moderationState === "REJECTED"
                ? "REJECTED"
                : asset.storageState === "QUARANTINED"
                  ? "HIDDEN"
                  : "PENDING";
        return {
          assetId: asset.id,
          issueSubmission: submission
            ? {
                id: submission.id,
                question: submission.question,
                publicationStatus: submission.status as NonNullable<
                  MemberModerationAsset["issueSubmission"]
                >["publicationStatus"],
                updatedAt: submission.updatedAt.toISOString(),
              }
            : null,
          assetReview: {
            status,
            policyVersion: decision?.policyVersion ?? "issue-media-review-v1",
            reasonCode: decision?.reasonCode ?? "AWAITING_REVIEW",
            action: decision?.status ?? "REVIEW",
            submittedAt: asset.createdAt.toISOString(),
            lastChangedAt: (decision?.createdAt ?? asset.updatedAt).toISOString(),
          },
          alternatives:
            status === "PENDING"
              ? ["TEXT_ONLY", "APPROVED_LIBRARY", "REPLACE_IMAGE", "CANCEL_IMAGE"]
              : [],
          appealId: activeAppeal.get(asset.id) ?? null,
        };
      });
      return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        assets: assetViews,
        libraryAssets: libraryAssets.flatMap((asset) =>
          asset.objectKey && options.publicUrl
            ? [{ assetId: asset.id, url: options.publicUrl(asset.objectKey) }]
            : [],
        ),
        notices: notices.map(noticeView),
        appeals: appeals.map(appealView),
        rightsCases: rightsCases.map(rightsView),
      };
    },

    async readNotifications(memberId) {
      const notices = await database
        .select()
        .from(memberModerationNotices)
        .where(eq(memberModerationNotices.memberId, memberId))
        .orderBy(desc(memberModerationNotices.createdAt))
        .limit(30);
      return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        unreadCount: notices.filter((notice) => !notice.readAt).length,
        items: notices.map(noticeView),
      };
    },

    async markNotificationsRead(memberId, noticeIds) {
      const uniqueIds = [...new Set(noticeIds)];
      if (uniqueIds.length === 0) return { updated: 0 };
      const updated = await database
        .update(memberModerationNotices)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(memberModerationNotices.memberId, memberId),
            inArray(memberModerationNotices.id, uniqueIds),
            isNull(memberModerationNotices.readAt),
          ),
        )
        .returning({ id: memberModerationNotices.id });
      return { updated: updated.length };
    },

    async createAppeal(input) {
      const target = await assertOwnedTarget(input.memberId, input.targetType, input.targetId);
      const [existing] = await database
        .select()
        .from(moderationAppeals)
        .where(
          and(
            eq(moderationAppeals.memberId, input.memberId),
            eq(moderationAppeals.targetType, input.targetType),
            eq(moderationAppeals.targetId, input.targetId),
            inArray(moderationAppeals.status, ["SUBMITTED", "IN_REVIEW"]),
          ),
        )
        .limit(1);
      if (existing) return appealView(existing);
      const [created] = await database
        .insert(moderationAppeals)
        .values({
          memberId: input.memberId,
          targetType: input.targetType,
          targetId: input.targetId,
          reason: input.reason,
          evidence: input.evidence ?? {},
        })
        .returning();
      if (!created) throw new Error("Appeal was not created.");
      const registered = await ensureRegisteredTarget({
        targetType: input.targetType,
        targetId: input.targetId,
        version: target.version,
        hash: target.hash,
        snapshot: target.snapshot,
      });
      const moderationCase = await ensureOpenCase({
        targetId: registered.id,
        riskLane: "HIGH",
        priority: "P1",
        slaDueAt: new Date(Date.now() + 72 * 60 * 60 * 1_000),
      });
      await operations.linkCaseReference({
        caseId: moderationCase.id,
        referenceType: "APPEAL",
        referenceId: created.id,
      });
      await database.insert(moderationAuditEvents).values({
        eventType: "APPEAL_SUBMITTED",
        entityType: "APPEAL",
        entityId: created.id,
        actorType: "MEMBER",
        actorMemberId: input.memberId,
        metadata: {
          caseId: moderationCase.id,
          targetType: input.targetType,
          targetId: input.targetId,
        },
      });
      await appendNotice({
        memberId: input.memberId,
        targetType: input.targetType,
        targetId: input.targetId,
        reasonCode: "APPEAL_SUBMITTED",
        actionType: "HUMAN_REVIEW",
        summary: "재검토 요청을 접수했습니다.",
        nextStep: "운영자 검토가 끝나면 이 화면에서 최종 결과와 복원 여부를 확인할 수 있습니다.",
      });
      return appealView(created);
    },

    async createRightsCase(input) {
      const target = await assertOwnedTarget(input.memberId, input.targetType, input.targetId);
      const schedule = rightsSchedule(input.requestType);
      const [created] = await database
        .insert(moderationRightsCases)
        .values({
          memberId: input.memberId,
          requestType: input.requestType,
          targetType: input.targetType,
          targetId: input.targetId,
          details: input.details,
          evidence: input.evidence ?? {},
          dueAt: schedule.dueAt,
          legalHoldUntil: schedule.legalHoldUntil,
        })
        .returning();
      if (!created) throw new Error("Rights case was not created.");
      const registered = await ensureRegisteredTarget({
        targetType: input.targetType,
        targetId: input.targetId,
        version: target.version,
        hash: target.hash,
        snapshot: target.snapshot,
      });
      const moderationCase = await ensureOpenCase({
        targetId: registered.id,
        riskLane: "RIGHTS",
        priority: "P0",
        slaDueAt: created.dueAt ?? undefined,
      });
      await operations.linkCaseReference({
        caseId: moderationCase.id,
        referenceType: "RIGHTS_REQUEST",
        referenceId: created.id,
      });
      await database.insert(moderationAuditEvents).values({
        eventType: "RIGHTS_REQUEST_SUBMITTED",
        entityType: "RIGHTS_REQUEST",
        entityId: created.id,
        actorType: "MEMBER",
        actorMemberId: input.memberId,
        metadata: { caseId: moderationCase.id, requestType: input.requestType },
      });
      await appendNotice({
        memberId: input.memberId,
        targetType: input.targetType,
        targetId: input.targetId,
        reasonCode: `${input.requestType}_RIGHTS_SUBMITTED`,
        actionType: "RIGHTS_REVIEW",
        summary: "권리 요청을 별도 사건으로 접수했습니다.",
        nextStep: "증빙과 법적 보존 필요 여부에 따라 처리 기한이 달라질 수 있습니다.",
      });
      return rightsView(created);
    },

    async chooseAssetAlternative(input) {
      return database.transaction(async (transaction) => {
        const [current] = await transaction
          .select()
          .from(memberIssueSubmissions)
          .where(
            and(
              eq(memberIssueSubmissions.id, input.submissionId),
              eq(memberIssueSubmissions.memberId, input.memberId),
            ),
          )
          .limit(1);
        if (!current)
          throw new MemberModerationError(
            "SUBMISSION_NOT_FOUND",
            404,
            "질문 제출 건을 찾지 못했습니다.",
          );
        let mediaAssetAId: string | null = null;
        let mediaAssetBId: string | null = null;
        if (["APPROVED_LIBRARY", "REPLACE_IMAGE"].includes(input.action)) {
          if (!input.replacementAssetAId || !input.replacementAssetBId) {
            throw new MemberModerationError(
              "REPLACEMENT_PAIR_REQUIRED",
              422,
              "A와 B 교체 이미지를 모두 선택해 주세요.",
            );
          }
          const replacements = await transaction
            .select()
            .from(issueMediaAssets)
            .where(
              inArray(issueMediaAssets.id, [input.replacementAssetAId, input.replacementAssetBId]),
            );
          const valid =
            replacements.length === 2 &&
            replacements.every((asset) =>
              input.action === "APPROVED_LIBRARY"
                ? asset.sourceType === "OPERATOR_UPLOAD" &&
                  asset.moderationState === "APPROVED" &&
                  asset.storageState === "PUBLISHED"
                : asset.uploadedByMemberId === input.memberId &&
                  asset.sourceType === "MEMBER_SUBMISSION" &&
                  asset.moderationState === "PENDING" &&
                  asset.storageState === "STAGED",
            );
          if (!valid)
            throw new MemberModerationError(
              "REPLACEMENT_INVALID",
              422,
              "사용할 수 없는 교체 이미지입니다.",
            );
          mediaAssetAId = input.replacementAssetAId;
          mediaAssetBId = input.replacementAssetBId;
        }
        const revision = current.revision + 1;
        const now = new Date();
        const normalized = {
          question: current.question,
          context: current.context,
          choiceA: current.choiceA,
          choiceB: current.choiceB,
          mediaAssetAId,
          mediaAssetBId,
          interestCardCode: current.interestCardCode,
        };
        await transaction
          .update(memberIssueSubmissions)
          .set({
            revision,
            status: "PENDING",
            mediaAssetAId,
            mediaAssetBId,
            contentHash: contentHash(normalized),
            reviewNote: null,
            reviewedAt: null,
            submittedAt: now,
            updatedAt: now,
          })
          .where(eq(memberIssueSubmissions.id, current.id));
        await transaction.insert(memberIssueSubmissionRevisions).values({
          id: randomUUID(),
          submissionId: current.id,
          memberId: input.memberId,
          revision,
          idempotencyKey: randomUUID(),
          ...normalized,
          contentHash: contentHash(normalized),
          submittedAt: now,
        });
        const originalTargets = [current.mediaAssetAId, current.mediaAssetBId].filter(
          (id): id is string => Boolean(id),
        );
        for (const targetId of originalTargets) {
          await transaction.insert(memberModerationNotices).values({
            memberId: input.memberId,
            targetType: "ISSUE_MEDIA_ASSET",
            targetId,
            policyVersion: "member-moderation-v1",
            reasonCode: input.action,
            actionType: "ASSET_ALTERNATIVE_SELECTED",
            summary: alternativeNotice(input.action),
            nextStep: "질문 상태와 이미지 상태는 서로 분리되어 표시됩니다.",
            effectiveAt: now,
          });
        }
        await transaction.insert(moderationAuditEvents).values({
          eventType: "ASSET_ALTERNATIVE_SELECTED",
          entityType: "TARGET",
          entityId: current.id,
          actorType: "MEMBER",
          actorMemberId: input.memberId,
          metadata: { action: input.action, revision },
        });
        return { updated: true as const, revision };
      });
    },
  };
}
