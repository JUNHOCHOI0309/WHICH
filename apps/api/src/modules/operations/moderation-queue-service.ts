import { createHash } from "node:crypto";

import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  commentReports,
  issueChoiceMedia,
  issueChoices,
  issueMediaAssets,
  issueMediaReviewDecisions,
  issueMediaRuleFindings,
  issueVersions,
  members,
  moderationActions,
  moderationAuditEvents,
  memberModerationNotices,
  moderationAppeals,
  moderationCaseReferences,
  moderationCases,
  moderationTargets,
  moderationRightsCases,
  operatorAccessGrants,
  operatorAuditLogs,
} from "../../database/schema/index.js";
import type { CommentService } from "../comments/contracts.js";
import type { IssueMediaReviewService } from "../issue-media/review-contracts.js";
import { createModerationOperationsService } from "../moderation-operations/service.js";
import { readModerationOperationalHealth } from "../moderation-operations/operational-health.js";
import type { ModerationProviderRuntimeDiagnostic } from "../moderation-providers/runtime-gate.js";

import type {
  OpsModerationQueueItem,
  OpsModerationQueueLane,
  OpsModerationQueuePage,
  OpsModerationQueueService,
} from "./moderation-queue-contracts.js";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function percentile(values: number[], quantile: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))]!;
}

function laneForRisk(riskLane: string, references: string[]): OpsModerationQueueLane {
  if (references.includes("APPEAL")) return "APPEAL";
  if (references.includes("RIGHTS_REQUEST") || riskLane === "RIGHTS") return "RIGHTS";
  if (references.includes("RANDOM_AUDIT")) return "RANDOM_AUDIT";
  return riskLane === "HIGH" || riskLane === "CRITICAL" ? "HIGH" : "NORMAL";
}

export function createOpsModerationQueueService(
  database: Database["db"],
  mediaReview: IssueMediaReviewService,
  commentsService: CommentService,
  providerRuntime: ModerationProviderRuntimeDiagnostic,
): OpsModerationQueueService {
  const operations = createModerationOperationsService(database);

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
    return Boolean(row);
  }

  async function audit(memberId: string, eventType: string, caseId: string, requestId: string) {
    await database.insert(moderationAuditEvents).values({
      eventType,
      entityType: "CASE",
      entityId: caseId,
      actorType: "OPERATOR",
      actorMemberId: memberId,
      metadata: { requestId },
    });
    await database.insert(operatorAuditLogs).values({
      memberId,
      eventType: `OPS_MODERATION_${eventType}`,
      outcome: "ALLOWED",
      requestId,
      metadata: { caseId },
    });
  }

  async function findOpenCase(targetId: string) {
    const [row] = await database
      .select({ id: moderationCases.id, expectedRevision: moderationCases.expectedRevision })
      .from(moderationCases)
      .where(
        and(
          eq(moderationCases.targetId, targetId),
          inArray(moderationCases.status, ["OPEN", "TRIAGED", "IN_REVIEW"]),
        ),
      )
      .orderBy(desc(moderationCases.createdAt))
      .limit(1);
    return row ?? null;
  }

  async function ensureCase(input: {
    type: "ISSUE_MEDIA_ASSET" | "COMMENT_VERSION";
    id: string;
    version: number;
    evidence: string;
    snapshotReference: string;
    riskLane: "LOW" | "MEDIUM" | "HIGH" | "RIGHTS";
    priority: "P0" | "P1" | "P2" | "P3";
  }) {
    const target = await operations.registerTarget({
      targetType: input.type,
      targetId: input.id,
      targetVersion: input.version,
      inputHash: hash(input.evidence),
      snapshotReference: input.snapshotReference,
    });
    const existing = await findOpenCase(target.id);
    if (existing) return existing;
    return operations.openCase({
      targetId: target.id,
      riskLane: input.riskLane,
      priority: input.priority,
      slaDueAt: new Date(Date.now() + (input.priority === "P0" ? 2 : 24) * 60 * 60 * 1000),
    });
  }

  async function synchronize(memberId: string, requestId: string) {
    const [media, commentCases, rights] = await Promise.all([
      mediaReview.readAssets({ memberId, limit: 50, requestId: `${requestId}:media` }),
      commentsService.listModerationCases(100),
      mediaReview.readRightsRequests({
        memberId,
        status: "OPEN",
        limit: 100,
        requestId: `${requestId}:rights`,
      }),
    ]);
    if (!media || !rights) return false;
    const rightsByAsset = new Map(
      rights.filter((item) => item.assetId).map((item) => [item.assetId!, item]),
    );
    for (const asset of media.items) {
      const hasBlockingFinding = asset.findings.some((finding) => finding.severity === "BLOCK");
      const randomAudit =
        asset.effectiveStatus === "APPROVED" && /^0[0-7]/.test(asset.sha256.slice(0, 2));
      if (
        !rightsByAsset.has(asset.id) &&
        asset.effectiveStatus !== "PENDING" &&
        asset.effectiveStatus !== "HIDDEN" &&
        !randomAudit
      )
        continue;
      const rightsRequest = rightsByAsset.get(asset.id);
      const riskLane = rightsRequest
        ? "RIGHTS"
        : asset.effectiveStatus === "HIDDEN" || hasBlockingFinding
          ? "HIGH"
          : randomAudit
            ? "LOW"
            : "MEDIUM";
      const priority = rightsRequest
        ? "P0"
        : asset.effectiveStatus === "HIDDEN" || hasBlockingFinding
          ? "P1"
          : randomAudit
            ? "P3"
            : "P2";
      const moderationCase = await ensureCase({
        type: "ISSUE_MEDIA_ASSET",
        id: asset.id,
        version: 1,
        evidence: `${asset.sha256}:${asset.rightsState}:${asset.effectiveStatus}:${asset.findings
          .map((finding) => `${finding.code}:${finding.sourceVersion}`)
          .join(",")}`,
        snapshotReference: `issue-media://${asset.id}`,
        riskLane,
        priority,
      });
      if (rightsRequest) {
        await operations.linkCaseReference({
          caseId: moderationCase.id,
          referenceType: "RIGHTS_REQUEST",
          referenceId: rightsRequest.id,
        });
      }
      if (randomAudit) {
        await operations.linkCaseReference({
          caseId: moderationCase.id,
          referenceType: "RANDOM_AUDIT",
          referenceId: asset.id,
        });
      }
    }
    for (const comment of commentCases.items) {
      const moderationCase = await ensureCase({
        type: "COMMENT_VERSION",
        id: comment.commentId,
        version: 1,
        evidence: `${comment.body}:${comment.visibility}:${comment.effectiveReportScore}`,
        snapshotReference: `comment://${comment.commentId}`,
        riskLane: comment.effectiveReportScore >= 20 ? "HIGH" : "MEDIUM",
        priority: comment.effectiveReportScore >= 20 ? "P0" : "P1",
      });
      const reports = await database
        .select({ id: commentReports.id })
        .from(commentReports)
        .where(
          and(eq(commentReports.commentId, comment.commentId), eq(commentReports.counted, true)),
        );
      for (const report of reports) {
        await operations.linkCaseReference({
          caseId: moderationCase.id,
          referenceType: "COMMENT_REPORT",
          referenceId: report.id,
        });
      }
    }
    return true;
  }

  async function imageContext(assetId: string) {
    const [row] = await database
      .select({
        asset: issueMediaAssets,
        uploadedBy: members.displayName,
        issueId: issueChoiceMedia.issueId,
        issueVersion: issueChoiceMedia.issueVersion,
        question: issueVersions.question,
      })
      .from(issueMediaAssets)
      .innerJoin(members, eq(members.id, issueMediaAssets.uploadedByMemberId))
      .leftJoin(issueChoiceMedia, eq(issueChoiceMedia.mediaAssetId, issueMediaAssets.id))
      .leftJoin(
        issueVersions,
        and(
          eq(issueVersions.issueId, issueChoiceMedia.issueId),
          eq(issueVersions.version, issueChoiceMedia.issueVersion),
        ),
      )
      .where(eq(issueMediaAssets.id, assetId))
      .limit(1);
    if (!row) return null;
    const choices =
      row.issueId && row.issueVersion
        ? await database
            .select({
              code: issueChoices.code,
              label: issueChoices.label,
              assetId: issueChoiceMedia.mediaAssetId,
              altText: issueChoiceMedia.altText,
              cropMode: issueChoiceMedia.cropMode,
            })
            .from(issueChoices)
            .leftJoin(
              issueChoiceMedia,
              and(
                eq(issueChoiceMedia.issueId, issueChoices.issueId),
                eq(issueChoiceMedia.issueVersion, issueChoices.issueVersion),
                eq(issueChoiceMedia.choiceId, issueChoices.id),
              ),
            )
            .where(
              and(
                eq(issueChoices.issueId, row.issueId),
                eq(issueChoices.issueVersion, row.issueVersion),
              ),
            )
            .orderBy(issueChoices.code)
        : [];
    const decisions = await database
      .select({
        id: issueMediaReviewDecisions.id,
        status: issueMediaReviewDecisions.status,
        reasonCode: issueMediaReviewDecisions.reasonCode,
        rationale: issueMediaReviewDecisions.rationale,
        reviewedBy: members.displayName,
        createdAt: issueMediaReviewDecisions.createdAt,
      })
      .from(issueMediaReviewDecisions)
      .innerJoin(members, eq(members.id, issueMediaReviewDecisions.reviewedByMemberId))
      .where(eq(issueMediaReviewDecisions.mediaAssetId, assetId))
      .orderBy(desc(issueMediaReviewDecisions.createdAt));
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
      kind: "IMAGE" as const,
      assetId,
      question: row.question,
      choices,
      rightsAttestation: row.asset.rightsAttestation,
      rightsState: row.asset.rightsState,
      uploadedBy: row.uploadedBy,
      input: {
        width: row.asset.inputWidth,
        height: row.asset.inputHeight,
        byteSize: row.asset.inputByteSize,
      },
      output: {
        width: row.asset.outputWidth,
        height: row.asset.outputHeight,
        byteSize: row.asset.outputByteSize,
      },
      findings: findings.map((finding) => ({
        ...finding,
        severity: finding.severity as "INFO" | "REVIEW" | "BLOCK",
        evidence: finding.evidence ?? {},
        createdAt: finding.createdAt.toISOString(),
      })),
      priorDecisions: decisions.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }

  return {
    async readQueue(input) {
      if (!(await operator(input.memberId))) return null;
      if (!(await synchronize(input.memberId, input.requestId))) return null;
      const rows = await database
        .select({ moderationCase: moderationCases, target: moderationTargets })
        .from(moderationCases)
        .innerJoin(moderationTargets, eq(moderationTargets.id, moderationCases.targetId))
        .where(inArray(moderationCases.status, ["OPEN", "TRIAGED", "IN_REVIEW"]))
        .orderBy(moderationCases.priority, moderationCases.createdAt);
      const caseIds = rows.map((row) => row.moderationCase.id);
      const references = caseIds.length
        ? await database
            .select({
              caseId: moderationCaseReferences.caseId,
              type: moderationCaseReferences.referenceType,
            })
            .from(moderationCaseReferences)
            .where(inArray(moderationCaseReferences.caseId, caseIds))
        : [];
      const referenceMap = new Map<string, string[]>();
      for (const reference of references)
        referenceMap.set(reference.caseId, [
          ...(referenceMap.get(reference.caseId) ?? []),
          reference.type,
        ]);
      const commentCases = await commentsService.listModerationCases(100);
      const commentMap = new Map(commentCases.items.map((item) => [item.commentId, item]));
      const items: OpsModerationQueueItem[] = [];
      for (const row of rows) {
        const lane = laneForRisk(
          row.moderationCase.riskLane,
          referenceMap.get(row.moderationCase.id) ?? [],
        );
        if (input.lane && lane !== input.lane) continue;
        let context: OpsModerationQueueItem["context"] | null = null;
        if (row.target.targetType === "ISSUE_MEDIA_ASSET")
          context = await imageContext(row.target.targetId);
        if (row.target.targetType === "COMMENT_VERSION") {
          const comment = commentMap.get(row.target.targetId);
          if (comment) context = { kind: "COMMENT", ...comment };
        }
        if (!context) continue;
        items.push({
          caseId: row.moderationCase.id,
          expectedRevision: row.moderationCase.expectedRevision,
          lane,
          priority: row.moderationCase.priority as OpsModerationQueueItem["priority"],
          status: row.moderationCase.status,
          targetType: row.target.targetType as OpsModerationQueueItem["targetType"],
          targetId: row.target.targetId,
          openedAt: row.moderationCase.createdAt.toISOString(),
          updatedAt: row.moderationCase.updatedAt.toISOString(),
          risky: ["HIGH", "RIGHTS", "APPEAL"].includes(lane),
          summary: context.kind === "IMAGE" ? (context.question ?? "연결 전 이미지") : context.body,
          context,
        });
        if (items.length >= input.limit) break;
      }
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 86400_000);
      const allOpen = rows.map((row) => row.moderationCase);
      const completed = await database
        .select({ createdAt: moderationCases.createdAt, updatedAt: moderationCases.updatedAt })
        .from(moderationCases)
        .where(
          and(eq(moderationCases.status, "RESOLVED"), gt(moderationCases.updatedAt, sevenDaysAgo)),
        );
      const durations = completed.map((row) =>
        Math.max(0, (row.updatedAt.getTime() - row.createdAt.getTime()) / 1000),
      );
      const [operatorSeconds, operational] = await Promise.all([
        database
          .select({ seconds: sql<number>`coalesce(sum(${moderationActions.durationSeconds}), 0)` })
          .from(moderationActions)
          .where(gt(moderationActions.createdAt, sevenDaysAgo)),
        readModerationOperationalHealth(database, providerRuntime),
      ]);
      const counts: OpsModerationQueuePage["counts"] = {
        HIGH: 0,
        NORMAL: 0,
        RIGHTS: 0,
        APPEAL: 0,
        RANDOM_AUDIT: 0,
      };
      for (const row of rows)
        counts[
          laneForRisk(row.moderationCase.riskLane, referenceMap.get(row.moderationCase.id) ?? [])
        ] += 1;
      await audit(
        input.memberId,
        "QUEUE_VIEWED",
        rows[0]?.moderationCase.id ?? "00000000-0000-0000-0000-000000000000",
        input.requestId,
      );
      return {
        schemaVersion: 1,
        generatedAt: now.toISOString(),
        metrics: {
          queueCount: allOpen.length,
          oldestAgeSeconds: allOpen.length
            ? Math.max(...allOpen.map((item) => (now.getTime() - item.createdAt.getTime()) / 1000))
            : null,
          reviewSecondsP50: percentile(durations, 0.5),
          reviewSecondsP95: percentile(durations, 0.95),
          averageSecondsPerAsset: durations.length
            ? durations.reduce((sum, value) => sum + value, 0) / durations.length
            : null,
          weeklyOperatorHours: Number(operatorSeconds[0]?.seconds ?? 0) / 3600,
          inflow7d: rows.filter((row) => row.moderationCase.createdAt > sevenDaysAgo).length,
          outflow7d: completed.length,
        },
        counts,
        operational,
        items,
      };
    },

    async recordView(input) {
      if (!(await operator(input.memberId))) return false;
      await audit(input.memberId, input.eventType, input.caseId, input.requestId);
      return true;
    },

    async decide(input) {
      if (!(await operator(input.memberId))) return null;
      const [row] = await database
        .select({ moderationCase: moderationCases, target: moderationTargets })
        .from(moderationCases)
        .innerJoin(moderationTargets, eq(moderationTargets.id, moderationCases.targetId))
        .where(eq(moderationCases.id, input.caseId))
        .limit(1);
      if (!row) throw new Error("Moderation case not found.");
      const claimed = await operations.updateCase({
        caseId: input.caseId,
        expectedRevision: input.decision.expectedRevision,
        status: "IN_REVIEW",
        assignedToMemberId: input.memberId,
      });
      const startedAt = Date.now();
      let domainDecisionType: "COMMENT_MODERATION_DECISION" | "ISSUE_MEDIA_REVIEW_DECISION";
      let domainDecisionId: string;
      let afterState: Record<string, unknown>;
      if (row.target.targetType === "ISSUE_MEDIA_ASSET") {
        const result = await mediaReview.decideAsset({
          memberId: input.memberId,
          assetId: row.target.targetId,
          status: input.decision.action as
            "APPROVED" | "REJECTED" | "HIDDEN" | "RESTORED" | "DELETED",
          reasonCode: input.decision.reasonCode,
          rationale: input.decision.rationale,
          policyVersion: input.decision.policyVersion,
          requestId: input.requestId,
        });
        if (!result?.latestDecision) throw new Error("Media decision was not recorded.");
        domainDecisionType = "ISSUE_MEDIA_REVIEW_DECISION";
        domainDecisionId = result.latestDecision.id;
        afterState = { status: result.effectiveStatus };
      } else {
        const result = await commentsService.decideModeration({
          commentId: row.target.targetId,
          action: input.decision.action as "COLLAPSE" | "HIDE" | "REMOVE_POLICY" | "RESTORE",
          reasonCode: input.decision.reasonCode,
        });
        domainDecisionType = "COMMENT_MODERATION_DECISION";
        domainDecisionId = result.decisionId;
        afterState = result.comment;
      }
      await operations.recordAction({
        caseId: input.caseId,
        actionType: input.decision.action,
        domainDecisionType,
        domainDecisionId,
        actorType: "OPERATOR",
        actorMemberId: input.memberId,
        beforeState: { status: row.moderationCase.status },
        afterState,
        durationSeconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
        noticeKey: `ops.moderation.${input.decision.action.toLowerCase()}`,
      });
      const caseReferences = await database
        .select({
          type: moderationCaseReferences.referenceType,
          id: moderationCaseReferences.referenceId,
        })
        .from(moderationCaseReferences)
        .where(eq(moderationCaseReferences.caseId, input.caseId));
      const now = new Date();
      for (const reference of caseReferences) {
        if (reference.type === "APPEAL") {
          const overturned = ["APPROVED", "RESTORED", "RESTORE"].includes(input.decision.action);
          const [appeal] = await database
            .update(moderationAppeals)
            .set({
              status: overturned ? "OVERTURNED" : "UPHELD",
              resolution: input.decision.rationale,
              reviewedAt: now,
              resolvedAt: now,
              updatedAt: now,
            })
            .where(eq(moderationAppeals.id, reference.id))
            .returning();
          if (appeal) {
            const [notice] = await database
              .insert(memberModerationNotices)
              .values({
                memberId: appeal.memberId,
                targetType: appeal.targetType,
                targetId: appeal.targetId,
                policyVersion: input.decision.policyVersion,
                reasonCode: input.decision.reasonCode,
                actionType: overturned ? "APPEAL_OVERTURNED" : "APPEAL_UPHELD",
                summary: overturned
                  ? "재검토 결과 기존 조치가 변경되었습니다."
                  : "재검토 결과 기존 조치가 유지됩니다.",
                nextStep: overturned
                  ? "복원된 상태를 다시 확인해 주세요."
                  : "권리 침해에 해당한다면 별도의 Rights 절차를 이용할 수 있습니다.",
                effectiveAt: now,
              })
              .returning({ id: memberModerationNotices.id });
            if (notice) {
              await database.insert(moderationAuditEvents).values({
                eventType: overturned ? "APPEAL_OVERTURNED" : "APPEAL_UPHELD",
                entityType: "APPEAL",
                entityId: appeal.id,
                actorType: "OPERATOR",
                actorMemberId: input.memberId,
                metadata: { caseId: input.caseId, noticeId: notice.id },
              });
            }
          }
        }
        if (reference.type === "RIGHTS_REQUEST") {
          const dismissed = ["APPROVED", "RESTORED", "RESTORE"].includes(input.decision.action);
          const [rights] = await database
            .update(moderationRightsCases)
            .set({
              status: dismissed ? "DISMISSED" : "ACTIONED",
              resolution: input.decision.rationale,
              resolvedAt: now,
              updatedAt: now,
            })
            .where(eq(moderationRightsCases.id, reference.id))
            .returning();
          if (rights) {
            const [notice] = await database
              .insert(memberModerationNotices)
              .values({
                memberId: rights.memberId,
                targetType: rights.targetType,
                targetId: rights.targetId,
                policyVersion: input.decision.policyVersion,
                reasonCode: input.decision.reasonCode,
                actionType: dismissed ? "RIGHTS_DISMISSED" : "RIGHTS_ACTIONED",
                summary: dismissed
                  ? "권리 요청 검토 결과 별도 조치 없이 종결되었습니다."
                  : "권리 요청에 따른 보호 조치가 완료되었습니다.",
                nextStep:
                  "제출한 사건의 최종 결과와 보존 기한을 내 Moderation에서 확인할 수 있습니다.",
                effectiveAt: now,
              })
              .returning({ id: memberModerationNotices.id });
            if (notice) {
              await database.insert(moderationAuditEvents).values({
                eventType: dismissed ? "RIGHTS_DISMISSED" : "RIGHTS_ACTIONED",
                entityType: "RIGHTS_REQUEST",
                entityId: rights.id,
                actorType: "OPERATOR",
                actorMemberId: input.memberId,
                metadata: { caseId: input.caseId, noticeId: notice.id },
              });
            }
          }
        }
      }
      const resolved = await operations.updateCase({
        caseId: input.caseId,
        expectedRevision: claimed.expectedRevision,
        status: "RESOLVED",
      });
      await audit(input.memberId, "DECISION_RECORDED", input.caseId, input.requestId);
      return { expectedRevision: resolved.expectedRevision };
    },
  };
}
