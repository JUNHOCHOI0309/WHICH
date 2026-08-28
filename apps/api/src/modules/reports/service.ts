import { createHash } from "node:crypto";

import { and, count, eq, gt, isNull, sql, sum } from "drizzle-orm";

import type { Database } from "../../database/client.js";
import {
  contentReportAttempts,
  contentReports,
  guestMemberLinks,
  issueMediaAssets,
  issues,
  memberSessions,
  members,
  reportCases,
  reportClusters,
  reporterSignalSnapshots,
  reportSignalSnapshots,
  voterSubjects,
} from "../../database/schema/index.js";

import type {
  ContentReportCommand,
  ContentReportResult,
  ContentReportService,
} from "./contracts.js";

const POLICY_VERSION = "report-signal-v2";
const REPORT_DAILY_LIMIT = 20;
const CLUSTER_WINDOW_MINUTES = 15;
const NEW_ACCOUNT_DAYS = 7;

export class ContentReportError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeDetail(command: ContentReportCommand) {
  const detail = command.detail?.replace(/\r\n?/g, "\n").normalize("NFC").trim();
  const length = detail ? Array.from(detail).length : 0;
  if (length > 1_000) {
    throw new ContentReportError(
      "REPORT_DETAIL_TOO_LONG",
      422,
      "Report detail must contain at most 1000 characters.",
    );
  }
  if (command.reasonCode === "OTHER" && length < 10) {
    throw new ContentReportError(
      "REPORT_DETAIL_REQUIRED",
      422,
      "OTHER reports require a detail of at least 10 characters.",
    );
  }
  return detail || undefined;
}

function fingerprint(command: ContentReportCommand, subjectId: string, detail?: string) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        command.idempotencyKey,
        subjectId,
        command.targetType,
        command.targetId,
        command.reasonCode,
        detail ?? null,
      ]),
    )
    .digest("hex");
}

function isStoredResult(value: unknown): value is ContentReportResult {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ContentReportResult>;
  return candidate.httpStatus === 201 && candidate.body?.report?.accepted === true;
}

function accountAgeDays(createdAt: Date, now: Date) {
  return Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 86_400_000));
}

function clusterWindowStart(now: Date) {
  const milliseconds = CLUSTER_WINDOW_MINUTES * 60_000;
  return new Date(Math.floor(now.getTime() / milliseconds) * milliseconds);
}

function ratioBasisPoints(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 10_000);
}

function clusterClassification(input: {
  reports15m: number;
  guestRatioBps: number;
  newAccountRatioBps: number;
}) {
  if (
    input.reports15m >= 5 &&
    (input.guestRatioBps >= 8_000 || input.newAccountRatioBps >= 6_000)
  ) {
    return "COORDINATED_SUSPECTED" as const;
  }
  return input.reports15m >= 3 ? ("CONCENTRATED" as const) : ("BASELINE" as const);
}

export function createContentReportService(database: Database["db"]): ContentReportService {
  return {
    async report(command) {
      const now = new Date();
      const detail = normalizeDetail(command);

      return database.transaction(async (transaction) => {
        let subjectId: string;
        let originSubjectId: string;
        let reporterKind: "GUEST" | "MEMBER" | "VERIFIED_MEMBER";
        let reporterCreatedAt: Date;

        if (command.sessionToken) {
          const [memberActor] = await transaction
            .select({
              subjectId: voterSubjects.id,
              kind: voterSubjects.kind,
              createdAt: members.createdAt,
            })
            .from(memberSessions)
            .innerJoin(members, eq(memberSessions.memberId, members.id))
            .innerJoin(voterSubjects, eq(voterSubjects.userId, members.id))
            .where(
              and(
                eq(memberSessions.tokenHash, hashToken(command.sessionToken)),
                isNull(memberSessions.revokedAt),
                gt(memberSessions.expiresAt, now),
                eq(members.status, "ACTIVE"),
              ),
            )
            .limit(1);
          if (
            !memberActor ||
            memberActor.kind === "GUEST" ||
            memberActor.kind === "DELETED_MEMBER"
          ) {
            throw new ContentReportError("SESSION_REQUIRED", 401, "The Member session is invalid.");
          }
          subjectId = memberActor.subjectId;
          originSubjectId = memberActor.subjectId;
          reporterKind = memberActor.kind;
          reporterCreatedAt = memberActor.createdAt;
        } else {
          if (!command.anonymousSubjectId) {
            throw new ContentReportError(
              "REPORT_SUBJECT_REQUIRED",
              401,
              "A Guest subject or Member session is required.",
            );
          }
          await transaction.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${command.anonymousSubjectId}, 0))`,
          );
          const [guestActor] = await transaction
            .select({ id: voterSubjects.id, createdAt: voterSubjects.createdAt })
            .from(voterSubjects)
            .where(
              and(
                eq(voterSubjects.kind, "GUEST"),
                eq(voterSubjects.anonymousSubjectId, command.anonymousSubjectId),
              ),
            )
            .limit(1);
          if (!guestActor) {
            throw new ContentReportError(
              "REPORT_SUBJECT_REQUIRED",
              401,
              "The Guest subject is invalid.",
            );
          }
          const [guestLink] = await transaction
            .select({
              memberSubjectId: guestMemberLinks.memberSubjectId,
              memberKind: voterSubjects.kind,
              memberCreatedAt: members.createdAt,
            })
            .from(guestMemberLinks)
            .innerJoin(voterSubjects, eq(voterSubjects.id, guestMemberLinks.memberSubjectId))
            .innerJoin(members, eq(members.id, guestMemberLinks.memberId))
            .where(eq(guestMemberLinks.guestSubjectId, guestActor.id))
            .limit(1);
          subjectId = guestLink?.memberSubjectId ?? guestActor.id;
          originSubjectId = guestActor.id;
          reporterKind =
            guestLink?.memberKind === "MEMBER" || guestLink?.memberKind === "VERIFIED_MEMBER"
              ? guestLink.memberKind
              : "GUEST";
          reporterCreatedAt = guestLink?.memberCreatedAt ?? guestActor.createdAt;
        }

        const requestFingerprint = fingerprint(command, subjectId, detail);
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${command.idempotencyKey}, 0))`,
        );
        const [existingAttempt] = await transaction
          .select({
            actorSubjectId: contentReportAttempts.actorSubjectId,
            requestFingerprint: contentReportAttempts.requestFingerprint,
            responseSnapshot: contentReportAttempts.responseSnapshot,
          })
          .from(contentReportAttempts)
          .where(eq(contentReportAttempts.id, command.idempotencyKey))
          .limit(1);
        if (existingAttempt) {
          if (
            existingAttempt.actorSubjectId !== subjectId ||
            existingAttempt.requestFingerprint !== requestFingerprint
          ) {
            throw new ContentReportError(
              "IDEMPOTENCY_CONFLICT",
              409,
              "The idempotency key was already used for another report.",
            );
          }
          if (!isStoredResult(existingAttempt.responseSnapshot)) {
            throw new ContentReportError(
              "REPORT_IN_PROGRESS",
              409,
              "The report request is still being processed.",
            );
          }
          return existingAttempt.responseSnapshot;
        }

        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${command.targetType}:${command.targetId}`}, 0))`,
        );
        if (command.targetType === "ISSUE") {
          const [target] = await transaction
            .select({ id: issues.id })
            .from(issues)
            .where(
              and(
                eq(issues.id, command.targetId),
                eq(issues.visibility, "VISIBLE"),
                sql`${issues.lifecycle} in ('PUBLISHED', 'CLOSED', 'ARCHIVED')`,
              ),
            )
            .limit(1);
          if (!target) {
            throw new ContentReportError(
              "REPORT_TARGET_UNAVAILABLE",
              404,
              "Issue is not reportable.",
            );
          }
        } else {
          const [target] = await transaction
            .select({ id: issueMediaAssets.id })
            .from(issueMediaAssets)
            .where(
              and(
                eq(issueMediaAssets.id, command.targetId),
                eq(issueMediaAssets.storageState, "PUBLISHED"),
              ),
            )
            .limit(1);
          if (!target) {
            throw new ContentReportError(
              "REPORT_TARGET_UNAVAILABLE",
              404,
              "Issue media asset is not reportable.",
            );
          }
        }

        const [duplicate] = await transaction
          .select({ id: contentReports.id })
          .from(contentReports)
          .where(
            and(
              eq(contentReports.targetType, command.targetType),
              eq(contentReports.targetId, command.targetId),
              eq(contentReports.subjectId, subjectId),
              eq(contentReports.counted, true),
            ),
          )
          .limit(1);
        if (duplicate) {
          throw new ContentReportError(
            "REPORT_ALREADY_EXISTS",
            409,
            "This subject already reported the target.",
          );
        }

        const [daily] = await transaction
          .select({ total: count() })
          .from(contentReports)
          .where(
            and(
              eq(contentReports.subjectId, subjectId),
              eq(contentReports.counted, true),
              gt(contentReports.createdAt, new Date(now.getTime() - 86_400_000)),
            ),
          );
        if ((daily?.total ?? 0) >= REPORT_DAILY_LIMIT) {
          throw new ContentReportError(
            "REPORT_RATE_LIMITED",
            429,
            "The daily content report limit has been reached.",
          );
        }

        await transaction.insert(contentReportAttempts).values({
          id: command.idempotencyKey,
          targetType: command.targetType,
          targetId: command.targetId,
          actorSubjectId: subjectId,
          requestFingerprint,
        });

        let [reportCase] = await transaction
          .select()
          .from(reportCases)
          .where(
            and(
              eq(reportCases.targetType, command.targetType),
              eq(reportCases.targetId, command.targetId),
              sql`${reportCases.status} in ('OPEN', 'QUARANTINED', 'PENDING_REVIEW')`,
            ),
          )
          .limit(1);
        if (!reportCase) {
          [reportCase] = await transaction
            .insert(reportCases)
            .values({
              targetType: command.targetType,
              targetId: command.targetId,
              policyVersion: POLICY_VERSION,
              createdAt: now,
              updatedAt: now,
            })
            .returning();
        }
        if (!reportCase) throw new Error("Report case insert did not return a row.");

        const windowStartedAt = clusterWindowStart(now);
        let [cluster] = await transaction
          .select()
          .from(reportClusters)
          .where(
            and(
              eq(reportClusters.caseId, reportCase.id),
              eq(reportClusters.windowStartedAt, windowStartedAt),
            ),
          )
          .limit(1);
        if (!cluster) {
          [cluster] = await transaction
            .insert(reportClusters)
            .values({ caseId: reportCase.id, windowStartedAt, createdAt: now, updatedAt: now })
            .returning();
        }
        if (!cluster) throw new Error("Report cluster insert did not return a row.");

        const ageDays = accountAgeDays(reporterCreatedAt, now);
        const [report] = await transaction
          .insert(contentReports)
          .values({
            caseId: reportCase.id,
            clusterId: cluster.id,
            targetType: command.targetType,
            targetId: command.targetId,
            subjectId,
            originSubjectId,
            reporterKind,
            reasonCode: command.reasonCode,
            detail,
            weightSnapshot: reporterKind === "GUEST" ? 1 : 2,
            accountAgeDays: ageDays,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: contentReports.id });
        if (!report) throw new Error("Content report insert did not return a row.");

        const since15m = new Date(now.getTime() - CLUSTER_WINDOW_MINUTES * 60_000);
        const since24h = new Date(now.getTime() - 86_400_000);
        const [aggregate] = await transaction
          .select({ reporterCount: count(), weightedScore: sum(contentReports.weightSnapshot) })
          .from(contentReports)
          .where(and(eq(contentReports.caseId, reportCase.id), eq(contentReports.counted, true)));
        const [last15m, last24h] = await Promise.all([
          transaction
            .select({
              reporterKind: contentReports.reporterKind,
              accountAgeDays: contentReports.accountAgeDays,
              originSubjectId: contentReports.originSubjectId,
            })
            .from(contentReports)
            .where(
              and(
                eq(contentReports.caseId, reportCase.id),
                eq(contentReports.counted, true),
                gt(contentReports.createdAt, since15m),
              ),
            ),
          transaction
            .select({ total: count() })
            .from(contentReports)
            .where(
              and(
                eq(contentReports.caseId, reportCase.id),
                eq(contentReports.counted, true),
                gt(contentReports.createdAt, since24h),
              ),
            ),
        ]);
        const reporterCount = aggregate?.reporterCount ?? 0;
        const weightedScore = Number(aggregate?.weightedScore ?? 0);
        const reports15m = last15m.length;
        const reports24h = last24h[0]?.total ?? 0;
        const guestRatioBps = ratioBasisPoints(
          last15m.filter((row) => row.reporterKind === "GUEST").length,
          reports15m,
        );
        const newAccountRatioBps = ratioBasisPoints(
          last15m.filter((row) => row.accountAgeDays < NEW_ACCOUNT_DAYS).length,
          reports15m,
        );
        const uniqueOriginCount = new Set(last15m.map((row) => row.originSubjectId)).size;
        const classification = clusterClassification({
          reports15m,
          guestRatioBps,
          newAccountRatioBps,
        });

        await transaction
          .update(reportClusters)
          .set({ classification, updatedAt: now })
          .where(eq(reportClusters.id, cluster.id));

        const criticalReason = command.reasonCode === "THREAT" || command.reasonCode === "PRIVACY";
        const credibleEvidence =
          reporterKind === "VERIFIED_MEMBER" && (detail ? Array.from(detail).length >= 20 : false);
        const priority =
          reportCase.priority === "P0" || criticalReason ? ("P0" as const) : ("NORMAL" as const);
        const requestedRecommendation = credibleEvidence
          ? ("QUARANTINE_REVIEW" as const)
          : criticalReason
            ? ("P0_REVIEW" as const)
            : ("NONE" as const);
        const recommendationRank = { NONE: 0, P0_REVIEW: 1, QUARANTINE_REVIEW: 2 } as const;
        const automationRecommendation =
          recommendationRank[
            reportCase.automationRecommendation as keyof typeof recommendationRank
          ] >= recommendationRank[requestedRecommendation]
            ? (reportCase.automationRecommendation as typeof requestedRecommendation)
            : requestedRecommendation;
        const status =
          reportCase.status === "QUARANTINED"
            ? ("QUARANTINED" as const)
            : reportCase.status === "PENDING_REVIEW" || criticalReason
              ? ("PENDING_REVIEW" as const)
              : ("OPEN" as const);
        if (
          reportCase.priority !== priority ||
          reportCase.automationRecommendation !== automationRecommendation ||
          reportCase.status !== status
        ) {
          await transaction
            .update(reportCases)
            .set({ priority, automationRecommendation, status, updatedAt: now })
            .where(eq(reportCases.id, reportCase.id));
        }

        await transaction.insert(reportSignalSnapshots).values({
          caseId: reportCase.id,
          clusterId: cluster.id,
          reportId: report.id,
          reporterCount,
          weightedScore,
          reports15m,
          reports24h,
          velocityPerHour: reports15m * 4,
          guestRatioBps,
          newAccountRatioBps,
          uniqueOriginCount,
          clusterClassification: classification,
          policyVersion: POLICY_VERSION,
          createdAt: now,
        });

        const since30d = new Date(now.getTime() - 30 * 86_400_000);
        const [reporterTotals] = await transaction
          .select({
            reports: count(),
            merged: sql<number>`count(*) filter (where ${contentReports.counted} = false)`,
          })
          .from(contentReports)
          .where(
            and(eq(contentReports.subjectId, subjectId), gt(contentReports.createdAt, since30d)),
          );
        const reports30d = reporterTotals?.reports ?? 0;
        const mergedDuplicates30d = Number(reporterTotals?.merged ?? 0);
        await transaction.insert(reporterSignalSnapshots).values({
          reportId: report.id,
          subjectId,
          reports30d,
          mergedDuplicates30d,
          accountAgeDays: ageDays,
          signalBand: reports30d >= 3 ? "ESTABLISHING" : "UNKNOWN",
          policyVersion: POLICY_VERSION,
          createdAt: now,
        });

        const response: ContentReportResult = {
          httpStatus: 201,
          body: {
            report: { id: report.id, accepted: true, counted: true },
            case: {
              id: reportCase.id,
              status,
              priority,
              automationRecommendation,
            },
            signals: {
              reporterCount,
              weightedScore,
              reports15m,
              reports24h,
              clusterClassification: classification,
              shadowOnly: true,
            },
          },
        };
        await transaction
          .update(contentReportAttempts)
          .set({ completedAt: now, responseSnapshot: response })
          .where(eq(contentReportAttempts.id, command.idempotencyKey));
        return response;
      });
    },
  };
}
