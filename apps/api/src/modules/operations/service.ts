import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "../../database/client.js";
import { operatorAccessGrants, operatorAuditLogs } from "../../database/schema/index.js";
import { loadIssueInventoryReadiness } from "../issue-publication/inventory.js";

import type { OpsDashboardService, OpsDashboardSnapshot, OpsDashboardWindow } from "./contracts.js";

const inventoryCandidatesSchema = z.object({
  longTermCandidateIds: z.array(z.string()),
});

type Warning = OpsDashboardSnapshot["warnings"][number];

function numberValue(value: number | string | null | undefined) {
  return value === null || value === undefined ? 0 : Number(value);
}

function nullableNumber(value: number | string | null | undefined) {
  return value === null || value === undefined ? null : Number(value);
}

function rate(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function findContentRoot() {
  const directory = [
    resolve(process.cwd(), "content"),
    resolve(process.cwd(), "apps/api/content"),
  ].find((candidate) => existsSync(candidate));
  if (!directory) throw new Error("The API content directory could not be located.");
  return directory;
}

const contentRoot = findContentRoot();

let editorialSnapshotPromise: ReturnType<typeof loadEditorialSnapshot> | undefined;

async function loadEditorialSnapshot() {
  const [readiness, inventory] = await Promise.all([
    loadIssueInventoryReadiness(
      resolve(contentRoot, "issue-packs/public-v0-inventory-policy.json"),
    ),
    readFile(resolve(contentRoot, "editorial/expanded/inventory-candidates-v2.json"), "utf8").then(
      (value) => inventoryCandidatesSchema.parse(JSON.parse(value) as unknown),
    ),
  ]);
  return { readiness, longTermIssues: inventory.longTermCandidateIds.length };
}

function editorialSnapshot() {
  editorialSnapshotPromise ??= loadEditorialSnapshot();
  return editorialSnapshotPromise;
}

export function createOpsDashboardService(
  database: Database["db"],
  options: { releaseId: string },
): OpsDashboardService {
  async function audit(input: {
    memberId: string;
    outcome: "ALLOWED" | "DENIED" | "FAILED";
    windowDays: OpsDashboardWindow;
    requestId?: string;
    metadata?: Record<string, unknown>;
  }) {
    await database.insert(operatorAuditLogs).values({
      memberId: input.memberId,
      eventType: "OPS_DASHBOARD_READ",
      outcome: input.outcome,
      requestId: input.requestId,
      windowDays: input.windowDays,
      metadata: input.metadata ?? {},
    });
  }

  return {
    async readDashboard(input) {
      const grant = await database
        .select({ id: operatorAccessGrants.id })
        .from(operatorAccessGrants)
        .where(
          and(
            eq(operatorAccessGrants.memberId, input.memberId),
            eq(operatorAccessGrants.role, "OPERATOR"),
            isNull(operatorAccessGrants.revokedAt),
          ),
        )
        .limit(1);

      if (!grant[0]) {
        await audit({
          memberId: input.memberId,
          outcome: "DENIED",
          windowDays: input.windowDays,
          requestId: input.requestId,
          metadata: { reason: "OPERATOR_ROLE_REQUIRED" },
        });
        return null;
      }

      try {
        const [
          migrationResult,
          outboxResult,
          backupResult,
          funnelResult,
          sourceVotesResult,
          excludedTrafficResult,
          productionContentResult,
          categoryResult,
          moderationResult,
          integrityResult,
          editorial,
        ] = await Promise.all([
          database.execute<{ applied: number; latest_applied_at: string | null }>(sql`
            select count(*)::int as applied,
              to_timestamp(max(created_at) / 1000.0)::text as latest_applied_at
            from drizzle.__drizzle_migrations
          `),
          database.execute<{
            total: number;
            pending: number;
            published: number;
            failed: number;
            oldest_pending_age_seconds: number | null;
          }>(sql`
            select count(*)::int as total,
              count(*) filter (where status = 'PENDING')::int as pending,
              count(*) filter (where status = 'PUBLISHED')::int as published,
              count(*) filter (where status = 'FAILED')::int as failed,
              extract(epoch from (transaction_timestamp() - min(occurred_at)
                filter (where status = 'PENDING')))::double precision as oldest_pending_age_seconds
            from outbox_events
          `),
          database.execute<{ confirmed_at: Date; backup_reference: string }>(sql`
            select confirmed_at, backup_reference
            from operator_backup_confirmations
            order by confirmed_at desc
            limit 1
          `),
          database.execute<{
            viewable: number;
            submit: number;
            accepted_sessions: number;
            accepted_votes: number;
            result: number;
            next: number;
            second_vote: number;
            refreshed_at: Date | null;
          }>(sql`
            select
              coalesce(sum(qualified_sessions), 0)::int as viewable,
              coalesce(sum(submit_sessions), 0)::int as submit,
              coalesce(sum(accepted_vote_sessions), 0)::int as accepted_sessions,
              coalesce(sum(accepted_votes), 0)::int as accepted_votes,
              coalesce(sum(result_sessions), 0)::int as result,
              coalesce(sum(next_issue_sessions), 0)::int as next,
              coalesce(sum(second_vote_sessions), 0)::int as second_vote,
              max(refreshed_at) as refreshed_at
            from analytics_daily_funnel_metrics_v2
            where metric_date >= ((now() at time zone 'UTC')::date
              - (${input.windowDays - 1} * interval '1 day'))::date
          `),
          database.execute<{ accepted: number }>(sql`
            select count(*)::int as accepted
            from votes v
            left join analytics_sessions s on s.analytics_session_id = v.analytics_session_id
            where v.integrity_state = 'ACCEPTED'
              and not v.is_test_subject
              and v.accepted_at >= (
                ((now() at time zone 'UTC')::date
                  - (${input.windowDays - 1} * interval '1 day'))::date at time zone 'UTC'
              )
              and s.traffic_class = 'PRODUCT'
              and not exists (
                select 1 from votes test_vote
                where test_vote.analytics_session_id = s.analytics_session_id
                  and test_vote.is_test_subject
              )
          `),
          database.execute<{ traffic_class: string; sessions: number }>(sql`
            select traffic_class, count(*)::int as sessions
            from analytics_sessions
            where last_activity_at >= now() - (${input.windowDays} * interval '1 day')
              and traffic_class <> 'PRODUCT'
            group by traffic_class
            order by traffic_class
          `),
          database.execute<{ eligible_issues: number; zero_exposure_issues: number }>(sql`
            select count(*)::int as eligible_issues,
              count(*) filter (where not exists (
                select 1
                from analytics_events e
                join analytics_sessions s on s.analytics_session_id = e.analytics_session_id
                where e.issue_id = i.issue_id
                  and e.event_type = 'ISSUE_VIEWABLE_IMPRESSION'
                  and e.occurred_at >= now() - (${input.windowDays} * interval '1 day')
                  and s.traffic_class = 'PRODUCT'
              ))::int as zero_exposure_issues
            from issues i
            where i.lifecycle = 'PUBLISHED'
              and i.visibility = 'VISIBLE'
              and i.participation = 'VOTING_OPEN'
              and i.feed_eligibility = 'ELIGIBLE'
              and (i.vote_open_at is null or i.vote_open_at <= now())
              and (i.vote_close_at is null or i.vote_close_at > now())
          `),
          database.execute<{ category_code: string; issues: number }>(sql`
            select iv.primary_category_code as category_code, count(*)::int as issues
            from issues i
            join issue_versions iv on iv.issue_id = i.issue_id
              and iv.issue_version = (
                select max(candidate.issue_version) from issue_versions candidate
                where candidate.issue_id = i.issue_id and candidate.published_at is not null
              )
            where i.lifecycle = 'PUBLISHED'
              and i.visibility = 'VISIBLE'
              and i.participation = 'VOTING_OPEN'
              and i.feed_eligibility = 'ELIGIBLE'
            group by iv.primary_category_code
            order by iv.primary_category_code
          `),
          database.execute<{
            reports: number;
            reported_comments: number;
            queue_size: number;
            oldest_queue_hours: number;
            decisions: number;
            hidden: number;
            restored: number;
          }>(sql`
            select
              (select count(*)::int from comment_reports
                where counted and created_at >= now() - (${input.windowDays} * interval '1 day'))
                as reports,
              (select count(distinct comment_id)::int from comment_reports
                where counted and created_at >= now() - (${input.windowDays} * interval '1 day'))
                as reported_comments,
              (select count(*)::int from comments
                where visibility = 'COLLAPSED' or publication_state = 'PENDING_HUMAN_REVIEW')
                as queue_size,
              coalesce((select extract(epoch from (now() - min(updated_at))) / 3600 from comments
                where visibility = 'COLLAPSED' or publication_state = 'PENDING_HUMAN_REVIEW'), 0)
                ::double precision as oldest_queue_hours,
              (select count(*)::int from comment_moderation_decisions
                where decided_at >= now() - (${input.windowDays} * interval '1 day')) as decisions,
              (select count(*)::int from comment_moderation_decisions
                where action in ('HIDE', 'REMOVE_POLICY')
                  and decided_at >= now() - (${input.windowDays} * interval '1 day')) as hidden,
              (select count(*)::int from comment_moderation_decisions
                where action = 'RESTORE'
                  and decided_at >= now() - (${input.windowDays} * interval '1 day')) as restored
          `),
          database.execute<{
            accepted: number;
            review: number;
            rejected_duplicate: number;
            rejected_abuse: number;
            invalidated: number;
            incomplete_attempts: number;
            rate_limit_buckets: number;
          }>(sql`
            select
              count(*) filter (where integrity_state = 'ACCEPTED')::int as accepted,
              count(*) filter (where integrity_state = 'REVIEW')::int as review,
              count(*) filter (where integrity_state = 'REJECTED_DUPLICATE')::int
                as rejected_duplicate,
              count(*) filter (where integrity_state = 'REJECTED_ABUSE')::int as rejected_abuse,
              count(*) filter (where integrity_state = 'INVALIDATED')::int as invalidated,
              (select count(*)::int from vote_attempts
                where received_at >= now() - (${input.windowDays} * interval '1 day')
                  and completed_at is null and received_at < now() - interval '5 minutes')
                as incomplete_attempts,
              (select count(*)::int from auth_rate_limit_windows
                where window_started_at >= now() - (${input.windowDays} * interval '1 day'))
                as rate_limit_buckets
            from votes
            where created_at >= now() - (${input.windowDays} * interval '1 day')
              and not is_test_subject
          `),
          editorialSnapshot(),
        ]);

        const migration = migrationResult.rows[0]!;
        const outbox = outboxResult.rows[0]!;
        const backup = backupResult.rows[0];
        const funnel = funnelResult.rows[0]!;
        const sourceAcceptedVotes = numberValue(sourceVotesResult.rows[0]?.accepted);
        const aggregatedAcceptedVotes = numberValue(funnel.accepted_votes);
        const acceptedSessions = numberValue(funnel.accepted_sessions);
        const difference = aggregatedAcceptedVotes - sourceAcceptedVotes;
        const production = productionContentResult.rows[0]!;
        const moderation = moderationResult.rows[0]!;
        const integrity = integrityResult.rows[0]!;
        const categoryMinimum = editorial.readiness.coverage.activeByCategory;
        const categories = categoryResult.rows.map((row) => ({
          categoryCode: row.category_code,
          issues: numberValue(row.issues),
        }));
        const categoryCounts = new Map(categories.map((row) => [row.categoryCode, row.issues]));
        const belowMinimumCategories = Object.keys(categoryMinimum)
          .map((categoryCode) => ({
            categoryCode,
            issues: categoryCounts.get(categoryCode) ?? 0,
            minimum: 3,
          }))
          .filter((row) => row.issues < row.minimum);

        const warnings: Warning[] = [];
        const refreshedAt = funnel.refreshed_at?.toISOString() ?? null;
        if (!refreshedAt) {
          warnings.push({
            code: "ANALYTICS_NOT_AGGREGATED",
            severity: "WARNING",
            message: "공식 퍼널 집계 기록이 없습니다. analytics aggregate 작업을 확인하세요.",
          });
        } else if (Date.now() - new Date(refreshedAt).getTime() > 6 * 60 * 60 * 1000) {
          warnings.push({
            code: "ANALYTICS_STALE",
            severity: "WARNING",
            message: "공식 퍼널 집계가 6시간 이상 갱신되지 않았습니다.",
          });
        }
        if (difference !== 0) {
          warnings.push({
            code: "FUNNEL_RECONCILIATION_MISMATCH",
            severity: "CRITICAL",
            message: `집계 Accepted Vote와 원천 Vote가 ${Math.abs(difference)}건 다릅니다.`,
          });
        }
        if (numberValue(outbox.failed) > 0) {
          warnings.push({
            code: "OUTBOX_DEAD_LETTERS",
            severity: "CRITICAL",
            message: `Outbox 실패 이벤트가 ${numberValue(outbox.failed)}건 있습니다.`,
          });
        }
        if (nullableNumber(outbox.oldest_pending_age_seconds)! > 300) {
          warnings.push({
            code: "OUTBOX_BACKLOG_STALE",
            severity: "WARNING",
            message: "가장 오래된 Outbox 대기 이벤트가 5분을 초과했습니다.",
          });
        }
        if (!backup) {
          warnings.push({
            code: "BACKUP_CONFIRMATION_MISSING",
            severity: "WARNING",
            message: "운영 백업 확인 기록이 없습니다.",
          });
        }
        if (
          numberValue(moderation.queue_size) > 0 &&
          numberValue(moderation.oldest_queue_hours) > 24
        ) {
          warnings.push({
            code: "MODERATION_SLA_EXCEEDED",
            severity: "WARNING",
            message: "가장 오래된 댓글 검토 건이 24시간을 초과했습니다.",
          });
        }
        if (!editorial.readiness.ready || belowMinimumCategories.length > 0) {
          warnings.push({
            code: "CONTENT_SUPPLY_ATTENTION",
            severity: "WARNING",
            message: "콘텐츠 공급 정책 또는 운영 DB 카테고리 최소 수량을 확인해야 합니다.",
          });
        }

        const snapshot: OpsDashboardSnapshot = {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          windowDays: input.windowDays,
          role: "OPERATOR",
          system: {
            releaseId: options.releaseId,
            apiReadiness: "READY",
            migrations: {
              applied: numberValue(migration.applied),
              latestAppliedAt: migration.latest_applied_at,
            },
            outbox: {
              total: numberValue(outbox.total),
              pending: numberValue(outbox.pending),
              published: numberValue(outbox.published),
              failed: numberValue(outbox.failed),
              oldestPendingAgeSeconds: nullableNumber(outbox.oldest_pending_age_seconds),
            },
            backup: {
              lastConfirmedAt: backup?.confirmed_at.toISOString() ?? null,
              reference: backup?.backup_reference ?? null,
            },
          },
          funnel: {
            officialPopulation:
              "PRODUCT analytics sessions only; TEST, OPERATOR, BOT, UNCLASSIFIED and test-subject votes excluded",
            refreshedAt,
            stages: {
              viewable: numberValue(funnel.viewable),
              submit: numberValue(funnel.submit),
              accepted: acceptedSessions,
              result: numberValue(funnel.result),
              next: numberValue(funnel.next),
              secondVote: numberValue(funnel.second_vote),
            },
            rates: {
              submitPerViewable: rate(numberValue(funnel.submit), numberValue(funnel.viewable)),
              acceptedPerSubmit: rate(acceptedSessions, numberValue(funnel.submit)),
              resultPerAccepted: rate(numberValue(funnel.result), acceptedSessions),
              nextPerResult: rate(numberValue(funnel.next), numberValue(funnel.result)),
              secondVotePerAccepted: rate(numberValue(funnel.second_vote), acceptedSessions),
            },
            reconciliation: {
              aggregatedAcceptedVotes,
              sourceAcceptedVotes,
              difference,
              status: difference === 0 ? "CONSISTENT" : "MISMATCH",
            },
            excludedSessions: excludedTrafficResult.rows.map((row) => ({
              trafficClass: row.traffic_class,
              sessions: numberValue(row.sessions),
            })),
          },
          content: {
            production: {
              eligibleIssues: numberValue(production.eligible_issues),
              zeroExposureIssues: numberValue(production.zero_exposure_issues),
              activeByCategory: categories,
              belowMinimumCategories,
            },
            editorial: {
              policyId: editorial.readiness.policyId,
              ready: editorial.readiness.ready,
              activeIssues: editorial.readiness.summary.activeIssues,
              reserveIssues: editorial.readiness.summary.approvedReserveIssues,
              longTermIssues: editorial.longTermIssues,
              dailyPublicationTarget: editorial.readiness.summary.dailyPublicationTarget,
              activeDaysOfSupply: editorial.readiness.summary.activeDaysOfSupply,
              reserveDaysOfSupply: editorial.readiness.summary.reserveDaysOfSupply,
              violationCount: editorial.readiness.violations.length,
            },
          },
          trust: {
            moderation: {
              reports: numberValue(moderation.reports),
              reportedComments: numberValue(moderation.reported_comments),
              queueSize: numberValue(moderation.queue_size),
              oldestQueueHours: numberValue(moderation.oldest_queue_hours),
              decisions: numberValue(moderation.decisions),
              hidden: numberValue(moderation.hidden),
              restored: numberValue(moderation.restored),
            },
            integrity: {
              acceptedVotes: numberValue(integrity.accepted),
              reviewVotes: numberValue(integrity.review),
              rejectedDuplicateVotes: numberValue(integrity.rejected_duplicate),
              rejectedAbuseVotes: numberValue(integrity.rejected_abuse),
              invalidatedVotes: numberValue(integrity.invalidated),
              incompleteVoteAttempts: numberValue(integrity.incomplete_attempts),
              authRateLimitBuckets: numberValue(integrity.rate_limit_buckets),
            },
          },
          warnings,
          runbooks: [
            { label: "배포·상태 확인", path: "docs/operations/public-v0-release-verification.md" },
            { label: "Outbox 복구", path: "docs/operations/outbox-publisher.md" },
            { label: "Issue Pack 발행", path: "docs/operations/issue-pack-publication.md" },
          ],
        };

        await audit({
          memberId: input.memberId,
          outcome: "ALLOWED",
          windowDays: input.windowDays,
          requestId: input.requestId,
          metadata: { warningCount: warnings.length },
        });
        return snapshot;
      } catch (error) {
        await audit({
          memberId: input.memberId,
          outcome: "FAILED",
          windowDays: input.windowDays,
          requestId: input.requestId,
          metadata: { reason: "READ_MODEL_FAILED" },
        }).catch(() => undefined);
        throw error;
      }
    },
  };
}
