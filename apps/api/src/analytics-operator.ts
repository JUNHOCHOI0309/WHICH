import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnvironment } from "dotenv";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { getConfig } from "./config.js";
import { createDatabase, type Database } from "./database/client.js";

loadEnvironment({
  path: [resolve(process.cwd(), "../../.env.local"), resolve(process.cwd(), "../../.env")],
  quiet: true,
});

const RAW_RETENTION_DAYS = 90;
const experimentPreRegistrationSchema = z.object({
  schemaVersion: z.literal(1),
  experimentId: z.string().min(1),
  status: z.literal("PLANNED"),
  hypothesis: z.string().min(1),
  population: z.object({
    trafficClass: z.literal("PRODUCT"),
    riskLevel: z.literal("LOW"),
    excludePolitical: z.literal(true),
    assignmentUnit: z.literal("analytics_session_id"),
  }),
  arms: z
    .array(
      z.object({ id: z.string().min(1), weight: z.number().int().positive(), label: z.string() }),
    )
    .length(2)
    .refine((arms) => arms.reduce((sum, arm) => sum + arm.weight, 0) === 100, {
      message: "Experiment arm weights must total 100.",
    }),
  primaryMetric: z.literal("nextIssueRate"),
  secondaryMetrics: z.array(z.string()).min(1),
  guardrails: z.array(z.string()).min(1),
  minimumRuntimeDays: z.number().int().positive(),
  minimumQualifiedSessionsPerArm: z.number().int().positive(),
  stoppingRule: z.string().min(1),
  activation: z.string().min(1),
});

type FunnelMetricRow = {
  source: string;
  medium: string;
  entry_surface: string;
  audience_segment: string;
  device_segment: string;
  qualified_sessions: number;
  submit_sessions: number;
  accepted_vote_sessions: number;
  accepted_votes: number;
  result_sessions: number;
  next_issue_sessions: number;
  second_vote_sessions: number;
  exhausted_sessions: number;
};

function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function assertWindowDays(days: number) {
  if (!Number.isInteger(days) || days < 1 || days > RAW_RETENTION_DAYS) {
    throw new Error(`Measurement window must be an integer between 1 and ${RAW_RETENTION_DAYS}.`);
  }
}

export async function refreshAnalyticsFunnelMetrics(database: Database["db"]) {
  await database.transaction(async (transaction) => {
    await transaction.execute(sql`delete from analytics_daily_funnel_metrics_v2`);
    await transaction.execute(sql`
      insert into analytics_daily_funnel_metrics_v2 (
        metric_date, source, medium, entry_surface, audience_segment, device_segment,
        qualified_sessions, submit_sessions, accepted_vote_sessions, accepted_votes,
        result_sessions, next_issue_sessions, second_vote_sessions, exhausted_sessions,
        refreshed_at
      )
      with eligible_sessions as (
        select s.*
        from analytics_sessions s
        where s.traffic_class = 'PRODUCT'
          and not exists (
            select 1 from votes test_vote
            where test_vote.analytics_session_id = s.analytics_session_id
              and test_vote.is_test_subject
          )
      ), session_days as (
        select distinct (e.occurred_at at time zone 'UTC')::date as metric_date,
          e.analytics_session_id
        from analytics_events e
        join eligible_sessions s on s.analytics_session_id = e.analytics_session_id
        union
        select distinct (v.accepted_at at time zone 'UTC')::date as metric_date,
          v.analytics_session_id
        from votes v
        join eligible_sessions s on s.analytics_session_id = v.analytics_session_id
        where v.integrity_state = 'ACCEPTED'
          and not v.is_test_subject
          and v.accepted_at is not null
      ), session_metrics as (
        select
          d.metric_date,
          coalesce(s.attribution_source, 'direct') as source,
          coalesce(s.attribution_medium, 'none') as medium,
          s.entry_surface,
          s.audience_segment,
          s.device_segment,
          exists (
            select 1 from analytics_events e
            where e.analytics_session_id = d.analytics_session_id
              and (e.occurred_at at time zone 'UTC')::date = d.metric_date
              and e.event_type = 'ISSUE_VIEWABLE_IMPRESSION'
          ) as qualified,
          exists (
            select 1 from analytics_events e
            where e.analytics_session_id = d.analytics_session_id
              and (e.occurred_at at time zone 'UTC')::date = d.metric_date
              and e.event_type = 'VOTE_SUBMIT'
          ) as submitted,
          (
            select count(*)::int from votes v
            where v.analytics_session_id = d.analytics_session_id
              and (v.accepted_at at time zone 'UTC')::date = d.metric_date
              and v.integrity_state = 'ACCEPTED'
              and not v.is_test_subject
          ) as accepted_votes,
          exists (
            select 1
            from analytics_events e
            where e.analytics_session_id = d.analytics_session_id
              and (e.occurred_at at time zone 'UTC')::date = d.metric_date
              and e.event_type = 'RESULT_VIEW'
              and exists (
                select 1 from votes v
                where v.analytics_session_id = e.analytics_session_id
                  and v.issue_id = e.issue_id
                  and v.issue_version = e.issue_version
                  and v.integrity_state = 'ACCEPTED'
                  and not v.is_test_subject
              )
          ) as result_seen,
          exists (
            select 1 from analytics_events e
            where e.analytics_session_id = d.analytics_session_id
              and (e.occurred_at at time zone 'UTC')::date = d.metric_date
              and e.event_type = 'NEXT_ISSUE_OPEN'
              and exists (
                select 1 from analytics_events result_event
                where result_event.analytics_session_id = d.analytics_session_id
                  and (result_event.occurred_at at time zone 'UTC')::date = d.metric_date
                  and result_event.event_type = 'RESULT_VIEW'
                  and exists (
                    select 1 from votes result_vote
                    where result_vote.analytics_session_id = result_event.analytics_session_id
                      and result_vote.issue_id = result_event.issue_id
                      and result_vote.issue_version = result_event.issue_version
                      and result_vote.integrity_state = 'ACCEPTED'
                      and not result_vote.is_test_subject
                  )
              )
          ) as next_opened,
          exists (
            select 1 from analytics_events e
            where e.analytics_session_id = d.analytics_session_id
              and (e.occurred_at at time zone 'UTC')::date = d.metric_date
              and e.event_type = 'NEXT_ISSUE_EXHAUSTED'
              and exists (
                select 1 from analytics_events result_event
                where result_event.analytics_session_id = d.analytics_session_id
                  and (result_event.occurred_at at time zone 'UTC')::date = d.metric_date
                  and result_event.event_type = 'RESULT_VIEW'
                  and exists (
                    select 1 from votes result_vote
                    where result_vote.analytics_session_id = result_event.analytics_session_id
                      and result_vote.issue_id = result_event.issue_id
                      and result_vote.issue_version = result_event.issue_version
                      and result_vote.integrity_state = 'ACCEPTED'
                      and not result_vote.is_test_subject
                  )
              )
          ) as exhausted
        from session_days d
        join eligible_sessions s on s.analytics_session_id = d.analytics_session_id
      )
      select
        metric_date, source, medium, entry_surface, audience_segment, device_segment,
        count(*) filter (where qualified)::int,
        count(*) filter (where submitted)::int,
        count(*) filter (where accepted_votes > 0)::int,
        coalesce(sum(accepted_votes), 0)::int,
        count(*) filter (where result_seen)::int,
        count(*) filter (where next_opened)::int,
        count(*) filter (where accepted_votes >= 2)::int,
        count(*) filter (where exhausted)::int,
        now()
      from session_metrics
      group by metric_date, source, medium, entry_surface, audience_segment, device_segment
    `);
  });
}

export async function refreshAnalyticsDailyMetrics(database: Database["db"]) {
  await database.transaction(async (transaction) => {
    await transaction.execute(sql`
      delete from analytics_daily_metrics m
      where m.metric_date in (
        select distinct (e.occurred_at at time zone 'UTC')::date from analytics_events e
        union
        select distinct (v.accepted_at at time zone 'UTC')::date
        from votes v
        where v.analytics_session_id is not null and v.accepted_at is not null
      )
    `);
    await transaction.execute(sql`
    insert into analytics_daily_metrics (
      metric_date, source, medium, campaign, content,
      qualified_sessions, accepted_vote_sessions, accepted_votes, second_vote_sessions,
      result_views, next_issue_opens, next_issue_exhausted, refreshed_at
    )
    with session_days as (
      select distinct (e.occurred_at at time zone 'UTC')::date as metric_date, e.analytics_session_id
      from analytics_events e
      union
      select distinct (v.accepted_at at time zone 'UTC')::date as metric_date, v.analytics_session_id
      from votes v
      where v.integrity_state = 'ACCEPTED'
        and not v.is_test_subject
        and v.analytics_session_id is not null
        and v.accepted_at is not null
    ), session_metrics as (
      select
        d.metric_date,
        coalesce(s.attribution_source, 'direct') as source,
        coalesce(s.attribution_medium, 'none') as medium,
        coalesce(s.attribution_campaign, 'none') as campaign,
        coalesce(s.attribution_content, 'none') as content,
        exists (
          select 1 from analytics_events e
          where e.analytics_session_id = d.analytics_session_id
            and (e.occurred_at at time zone 'UTC')::date = d.metric_date
            and e.event_type = 'ISSUE_VIEWABLE_IMPRESSION'
        ) as qualified,
        exists (
          select 1 from votes v
          where v.analytics_session_id = d.analytics_session_id
            and (v.accepted_at at time zone 'UTC')::date = d.metric_date
            and v.integrity_state = 'ACCEPTED' and not v.is_test_subject
        ) as accepted_vote,
        (
          select count(*)::int from votes v
          where v.analytics_session_id = d.analytics_session_id
            and (v.accepted_at at time zone 'UTC')::date = d.metric_date
            and v.integrity_state = 'ACCEPTED' and not v.is_test_subject
        ) as accepted_votes,
        (
          select count(*) from votes v
          where v.analytics_session_id = d.analytics_session_id
            and (v.accepted_at at time zone 'UTC')::date = d.metric_date
            and v.integrity_state = 'ACCEPTED' and not v.is_test_subject
        ) >= 2 as second_vote,
        (
          select count(distinct e.issue_id)::int from analytics_events e
          where e.analytics_session_id = d.analytics_session_id
            and (e.occurred_at at time zone 'UTC')::date = d.metric_date
            and e.event_type = 'RESULT_VIEW'
        ) as result_views,
        (
          select count(distinct e.issue_id)::int from analytics_events e
          where e.analytics_session_id = d.analytics_session_id
            and (e.occurred_at at time zone 'UTC')::date = d.metric_date
            and e.event_type = 'NEXT_ISSUE_OPEN'
        ) as next_issue_opens,
        (
          select count(distinct e.issue_id)::int from analytics_events e
          where e.analytics_session_id = d.analytics_session_id
            and (e.occurred_at at time zone 'UTC')::date = d.metric_date
            and e.event_type = 'NEXT_ISSUE_EXHAUSTED'
        ) as next_issue_exhausted
      from session_days d
      join analytics_sessions s on s.analytics_session_id = d.analytics_session_id
    )
    select
      metric_date, source, medium, campaign, content,
      count(*) filter (where qualified)::int,
      count(*) filter (where accepted_vote)::int,
      sum(accepted_votes)::int,
      count(*) filter (where second_vote)::int,
      sum(result_views)::int,
      sum(next_issue_opens)::int,
      sum(next_issue_exhausted)::int,
      now()
    from session_metrics
    group by metric_date, source, medium, campaign, content
    on conflict (metric_date, source, medium, campaign, content) do update set
      qualified_sessions = excluded.qualified_sessions,
      accepted_vote_sessions = excluded.accepted_vote_sessions,
      accepted_votes = excluded.accepted_votes,
      second_vote_sessions = excluded.second_vote_sessions,
      result_views = excluded.result_views,
      next_issue_opens = excluded.next_issue_opens,
      next_issue_exhausted = excluded.next_issue_exhausted,
      refreshed_at = excluded.refreshed_at
    `);
  });
}

export async function applyAnalyticsRetention(database: Database["db"]) {
  await refreshAnalyticsDailyMetrics(database);
  const deletedEvents = await database.execute(sql`
    delete from analytics_events
    where received_at < now() - (${RAW_RETENTION_DAYS} * interval '1 day')
    returning event_id
  `);
  const deletedSessions = await database.execute(sql`
    delete from analytics_sessions s
    where s.last_activity_at < now() - (${RAW_RETENTION_DAYS} * interval '1 day')
      and not exists (
        select 1 from analytics_events e where e.analytics_session_id = s.analytics_session_id
      )
    returning analytics_session_id
  `);
  return {
    deletedEvents: deletedEvents.rowCount ?? 0,
    deletedSessions: deletedSessions.rowCount ?? 0,
  };
}

export async function readLegacyAnalyticsSummary(database: Database["db"], days: number) {
  await refreshAnalyticsDailyMetrics(database);
  const result = await database.execute<{
    source: string;
    medium: string;
    qualified_sessions: number;
    accepted_vote_sessions: number;
    accepted_votes: number;
    second_vote_sessions: number;
    result_views: number;
    next_issue_opens: number;
    next_issue_exhausted: number;
  }>(sql`
    select
      source,
      medium,
      sum(qualified_sessions)::int as qualified_sessions,
      sum(accepted_vote_sessions)::int as accepted_vote_sessions,
      sum(accepted_votes)::int as accepted_votes,
      sum(second_vote_sessions)::int as second_vote_sessions,
      sum(result_views)::int as result_views,
      sum(next_issue_opens)::int as next_issue_opens,
      sum(next_issue_exhausted)::int as next_issue_exhausted
    from analytics_daily_metrics
    where metric_date >= ((now() at time zone 'UTC')::date - (${days - 1} * interval '1 day'))::date
    group by source, medium
    order by accepted_vote_sessions desc, source, medium
  `);
  const channels = result.rows;
  const total = channels.reduce(
    (sum, row) => ({
      qualifiedSessions: sum.qualifiedSessions + row.qualified_sessions,
      acceptedVoteSessions: sum.acceptedVoteSessions + row.accepted_vote_sessions,
      acceptedVotes: sum.acceptedVotes + row.accepted_votes,
      secondVoteSessions: sum.secondVoteSessions + row.second_vote_sessions,
      resultViews: sum.resultViews + row.result_views,
      nextIssueOpens: sum.nextIssueOpens + row.next_issue_opens,
      nextIssueExhausted: sum.nextIssueExhausted + row.next_issue_exhausted,
    }),
    {
      qualifiedSessions: 0,
      acceptedVoteSessions: 0,
      acceptedVotes: 0,
      secondVoteSessions: 0,
      resultViews: 0,
      nextIssueOpens: 0,
      nextIssueExhausted: 0,
    },
  );
  const nextIssueEligible = Math.max(0, total.resultViews - total.nextIssueExhausted);
  return {
    windowDays: days,
    generatedAt: new Date().toISOString(),
    metrics: {
      qualifiedVotePerSession:
        total.qualifiedSessions === 0 ? 0 : total.acceptedVotes / total.qualifiedSessions,
      firstVoteConversion:
        total.qualifiedSessions === 0 ? 0 : total.acceptedVoteSessions / total.qualifiedSessions,
      secondVoteConversion:
        total.qualifiedSessions === 0 ? 0 : total.secondVoteSessions / total.qualifiedSessions,
      nextIssueRate: nextIssueEligible === 0 ? 0 : total.nextIssueOpens / nextIssueEligible,
      ...total,
    },
    acquisitionChannels: channels,
  };
}

export async function readAnalyticsSummary(database: Database["db"], days: number) {
  assertWindowDays(days);
  await refreshAnalyticsFunnelMetrics(database);
  const result = await database.execute<FunnelMetricRow>(sql`
    select
      source,
      medium,
      entry_surface,
      audience_segment,
      device_segment,
      sum(qualified_sessions)::int as qualified_sessions,
      sum(submit_sessions)::int as submit_sessions,
      sum(accepted_vote_sessions)::int as accepted_vote_sessions,
      sum(accepted_votes)::int as accepted_votes,
      sum(result_sessions)::int as result_sessions,
      sum(next_issue_sessions)::int as next_issue_sessions,
      sum(second_vote_sessions)::int as second_vote_sessions,
      sum(exhausted_sessions)::int as exhausted_sessions
    from analytics_daily_funnel_metrics_v2
    where metric_date >= ((now() at time zone 'UTC')::date - (${days - 1} * interval '1 day'))::date
    group by source, medium, entry_surface, audience_segment, device_segment
    order by accepted_vote_sessions desc, source, medium, entry_surface, audience_segment, device_segment
  `);
  const segments = result.rows;
  const totals = segments.reduce(
    (sum, row) => ({
      qualifiedSessions: sum.qualifiedSessions + row.qualified_sessions,
      submitSessions: sum.submitSessions + row.submit_sessions,
      acceptedVoteSessions: sum.acceptedVoteSessions + row.accepted_vote_sessions,
      acceptedVotes: sum.acceptedVotes + row.accepted_votes,
      resultSessions: sum.resultSessions + row.result_sessions,
      nextIssueSessions: sum.nextIssueSessions + row.next_issue_sessions,
      secondVoteSessions: sum.secondVoteSessions + row.second_vote_sessions,
      exhaustedSessions: sum.exhaustedSessions + row.exhausted_sessions,
    }),
    {
      qualifiedSessions: 0,
      submitSessions: 0,
      acceptedVoteSessions: 0,
      acceptedVotes: 0,
      resultSessions: 0,
      nextIssueSessions: 0,
      secondVoteSessions: 0,
      exhaustedSessions: 0,
    },
  );
  const nextEligibleSessions = Math.max(0, totals.resultSessions - totals.exhaustedSessions);
  const traffic = await database.execute<{ traffic_class: string; sessions: number }>(sql`
    select s.traffic_class, count(distinct s.analytics_session_id)::int as sessions
    from analytics_sessions s
    where s.last_activity_at >= now() - (${days} * interval '1 day')
    group by s.traffic_class
    order by s.traffic_class
  `);
  return {
    schemaVersion: 2,
    windowDays: days,
    generatedAt: new Date().toISOString(),
    officialPopulation: "trafficClass=PRODUCT; sessions containing isTestSubject votes excluded",
    metrics: {
      ...totals,
      qualifiedVotePerSession: ratio(totals.acceptedVotes, totals.qualifiedSessions),
      submitRate: ratio(totals.submitSessions, totals.qualifiedSessions),
      acceptanceAfterSubmitRate: ratio(totals.acceptedVoteSessions, totals.submitSessions),
      firstVoteConversion: ratio(totals.acceptedVoteSessions, totals.qualifiedSessions),
      resultAfterAcceptedRate: ratio(totals.resultSessions, totals.acceptedVoteSessions),
      nextIssueRate: ratio(totals.nextIssueSessions, nextEligibleSessions),
      secondVoteConversion: ratio(totals.secondVoteSessions, totals.qualifiedSessions),
      nextIssueExhaustedRate: ratio(totals.exhaustedSessions, totals.resultSessions),
    },
    segments,
    trafficCoverage: traffic.rows,
  };
}

export async function readAnalyticsQualitySummary(database: Database["db"], days: number) {
  assertWindowDays(days);
  const result = await database.execute<{
    exposed_sessions: number;
    vote_sessions: number;
    next_sessions: number;
    comment_sessions: number;
    share_sessions: number;
    result_sessions: number;
    quick_exit_sessions: number;
    report_sessions: number;
  }>(sql`
    with product_events as (
      select e.*
      from analytics_events e
      join analytics_sessions s on s.analytics_session_id = e.analytics_session_id
      where e.occurred_at >= now() - (${days} * interval '1 day')
        and s.traffic_class = 'PRODUCT'
    ), session_flags as (
      select analytics_session_id,
        bool_or(event_type = 'ISSUE_VIEWABLE_IMPRESSION') as exposed,
        bool_or(event_type = 'VOTE_SUBMIT') as voted,
        bool_or(event_type = 'NEXT_ISSUE_OPEN') as opened_next,
        bool_or(event_type = 'COMMENT_COMPLETE') as commented,
        bool_or(event_type = 'SHARE_COMPLETE') as shared,
        bool_or(event_type = 'RESULT_VIEW') as viewed_result,
        bool_or(event_type = 'RESULT_DWELL_COMPLETE' and duration_ms <= 2000) as quick_exit,
        bool_or(event_type = 'COMMENT_REPORT_COMPLETE') as reported
      from product_events
      group by analytics_session_id
    )
    select
      count(*) filter (where exposed)::int as exposed_sessions,
      count(*) filter (where voted)::int as vote_sessions,
      count(*) filter (where voted and opened_next)::int as next_sessions,
      count(*) filter (where voted and commented)::int as comment_sessions,
      count(*) filter (where voted and shared)::int as share_sessions,
      count(*) filter (where viewed_result)::int as result_sessions,
      count(*) filter (where quick_exit)::int as quick_exit_sessions,
      count(*) filter (where voted and reported)::int as report_sessions
    from session_flags
  `);
  const totals = result.rows[0] ?? {
    exposed_sessions: 0,
    vote_sessions: 0,
    next_sessions: 0,
    comment_sessions: 0,
    share_sessions: 0,
    result_sessions: 0,
    quick_exit_sessions: 0,
    report_sessions: 0,
  };
  return {
    schemaVersion: 1,
    windowDays: days,
    generatedAt: new Date().toISOString(),
    definition: {
      quickExitThresholdMs: 2000,
      population: "trafficClass=PRODUCT distinct analytics sessions",
    },
    counts: {
      exposedSessions: totals.exposed_sessions,
      voteSessions: totals.vote_sessions,
      nextIssueSessions: totals.next_sessions,
      commentSessions: totals.comment_sessions,
      shareSessions: totals.share_sessions,
      resultSessions: totals.result_sessions,
      quickExitSessions: totals.quick_exit_sessions,
      reportSessions: totals.report_sessions,
    },
    metrics: {
      exposureToVoteRate: ratio(totals.vote_sessions, totals.exposed_sessions),
      voteToNextRate: ratio(totals.next_sessions, totals.vote_sessions),
      commentAfterVoteRate: ratio(totals.comment_sessions, totals.vote_sessions),
      shareAfterVoteRate: ratio(totals.share_sessions, totals.vote_sessions),
      quickExitRate: ratio(totals.quick_exit_sessions, totals.result_sessions),
      reportAfterVoteRate: ratio(totals.report_sessions, totals.vote_sessions),
    },
  };
}

export async function readAnalyticsReconciliation(database: Database["db"], days: number) {
  assertWindowDays(days);
  const eventLedger = await database.execute<{
    accepted_votes: number;
    linked_votes: number;
    missing_submit: number;
    missing_result: number;
  }>(sql`
    with accepted as (
      select v.*
      from votes v
      left join analytics_sessions s on s.analytics_session_id = v.analytics_session_id
      where v.integrity_state = 'ACCEPTED'
        and not v.is_test_subject
        and v.accepted_at >= now() - (${days} * interval '1 day')
        and (s.analytics_session_id is null or s.traffic_class = 'PRODUCT')
    )
    select
      count(*)::int as accepted_votes,
      count(*) filter (where a.analytics_session_id is not null)::int as linked_votes,
      count(*) filter (
        where a.analytics_session_id is not null and not exists (
          select 1 from analytics_events e
          where e.analytics_session_id = a.analytics_session_id
            and e.issue_id = a.issue_id
            and e.issue_version = a.issue_version
            and e.event_type = 'VOTE_SUBMIT'
        )
      )::int as missing_submit,
      count(*) filter (
        where a.analytics_session_id is not null and not exists (
          select 1 from analytics_events e
          where e.analytics_session_id = a.analytics_session_id
            and e.issue_id = a.issue_id
            and e.issue_version = a.issue_version
            and e.event_type = 'RESULT_VIEW'
        )
      )::int as missing_result
    from accepted a
  `);
  const orphanSubmit = await database.execute<{ orphan_submits: number }>(sql`
    select count(*)::int as orphan_submits
    from analytics_events e
    join analytics_sessions s on s.analytics_session_id = e.analytics_session_id
    where e.event_type = 'VOTE_SUBMIT'
      and e.occurred_at >= now() - (${days} * interval '1 day')
      and s.traffic_class = 'PRODUCT'
      and not exists (
        select 1 from votes v
        where v.analytics_session_id = e.analytics_session_id
          and v.issue_id = e.issue_id
          and v.issue_version = e.issue_version
          and v.created_at between e.occurred_at - interval '5 minutes'
            and e.occurred_at + interval '30 minutes'
      )
  `);
  const aggregate = await database.execute<{
    mismatched_issues: number;
    absolute_vote_delta: number;
  }>(sql`
    with ledger as (
      select issue_id, issue_version, count(*)::int as accepted_vote_count
      from votes
      where integrity_state = 'ACCEPTED' and not is_test_subject
      group by issue_id, issue_version
    ), comparison as (
      select
        coalesce(l.issue_id, a.issue_id) as issue_id,
        coalesce(l.issue_version, a.issue_version) as issue_version,
        coalesce(l.accepted_vote_count, 0) as ledger_count,
        coalesce(a.accepted_vote_count, 0) as aggregate_count
      from ledger l
      full join vote_aggregates a
        on a.issue_id = l.issue_id and a.issue_version = l.issue_version
    )
    select
      count(*) filter (where ledger_count <> aggregate_count)::int as mismatched_issues,
      coalesce(sum(abs(ledger_count - aggregate_count)), 0)::int as absolute_vote_delta
    from comparison
  `);
  const ledger = eventLedger.rows[0] ?? {
    accepted_votes: 0,
    linked_votes: 0,
    missing_submit: 0,
    missing_result: 0,
  };
  const projection = aggregate.rows[0] ?? { mismatched_issues: 0, absolute_vote_delta: 0 };
  const quality = await database.execute<{
    vote_events_missing_choice_context: number;
    dwell_events_missing_duration: number;
    events_missing_session: number;
  }>(sql`
    select
      count(*) filter (
        where e.event_type = 'VOTE_SUBMIT'
          and (e.canonical_choice_id is null or e.shown_position is null)
      )::int as vote_events_missing_choice_context,
      count(*) filter (
        where e.event_type = 'RESULT_DWELL_COMPLETE' and e.duration_ms is null
      )::int as dwell_events_missing_duration,
      count(*) filter (where s.analytics_session_id is null)::int as events_missing_session
    from analytics_events e
    left join analytics_sessions s on s.analytics_session_id = e.analytics_session_id
    where e.occurred_at >= now() - (${days} * interval '1 day')
  `);
  const dataQuality = quality.rows[0] ?? {
    vote_events_missing_choice_context: 0,
    dwell_events_missing_duration: 0,
    events_missing_session: 0,
  };
  return {
    windowDays: days,
    voteEventLedger: {
      acceptedVotes: ledger.accepted_votes,
      analyticsLinkedVotes: ledger.linked_votes,
      acceptedVotesMissingAnalyticsSession: ledger.accepted_votes - ledger.linked_votes,
      analyticsLinkRate: ratio(ledger.linked_votes, ledger.accepted_votes),
      acceptedVotesMissingSubmitEvent: ledger.missing_submit,
      acceptedVotesMissingResultEvent: ledger.missing_result,
      submitEventsWithoutTerminalVote: orphanSubmit.rows[0]?.orphan_submits ?? 0,
    },
    voteAggregateProjection: {
      mismatchedIssues: projection.mismatched_issues,
      absoluteVoteDelta: projection.absolute_vote_delta,
    },
    dataQuality: {
      voteEventsMissingChoiceContext: dataQuality.vote_events_missing_choice_context,
      dwellEventsMissingDuration: dataQuality.dwell_events_missing_duration,
      eventsMissingSession: dataQuality.events_missing_session,
    },
  };
}

export async function readContentSupplySummary(database: Database["db"], days: number) {
  assertWindowDays(days);
  const categories = await database.execute<{ category: string; active_issues: number }>(sql`
    select iv.primary_category_code as category, count(*)::int as active_issues
    from issues i
    join lateral (
      select version.primary_category_code
      from issue_versions version
      where version.issue_id = i.issue_id and version.published_at is not null
      order by version.issue_version desc
      limit 1
    ) iv on true
    where i.lifecycle = 'PUBLISHED'
      and i.visibility = 'VISIBLE'
      and i.participation = 'VOTING_OPEN'
      and i.feed_eligibility = 'ELIGIBLE'
      and (i.vote_open_at is null or i.vote_open_at <= now())
      and (i.vote_close_at is null or i.vote_close_at > now())
    group by iv.primary_category_code
    order by active_issues desc, category
  `);
  const activity = await database.execute<{
    active_issues: number;
    zero_exposure_issues: number;
    zero_vote_issues: number;
    accepted_votes: number;
    top_issue_votes: number;
  }>(sql`
    with active as (
      select i.issue_id
      from issues i
      where i.lifecycle = 'PUBLISHED'
        and i.visibility = 'VISIBLE'
        and i.participation = 'VOTING_OPEN'
        and i.feed_eligibility = 'ELIGIBLE'
        and (i.vote_open_at is null or i.vote_open_at <= now())
        and (i.vote_close_at is null or i.vote_close_at > now())
        and exists (
          select 1 from issue_versions iv
          where iv.issue_id = i.issue_id and iv.published_at is not null
        )
    ), exposure as (
      select issue_id, count(*)::int as exposures
      from analytics_events e
      join analytics_sessions s on s.analytics_session_id = e.analytics_session_id
      where e.event_type = 'ISSUE_VIEWABLE_IMPRESSION'
        and e.occurred_at >= now() - (${days} * interval '1 day')
        and s.traffic_class = 'PRODUCT'
      group by issue_id
    ), accepted as (
      select issue_id, count(*)::int as votes
      from votes
      where integrity_state = 'ACCEPTED'
        and not is_test_subject
        and accepted_at >= now() - (${days} * interval '1 day')
      group by issue_id
    )
    select
      count(*)::int as active_issues,
      count(*) filter (where coalesce(e.exposures, 0) = 0)::int as zero_exposure_issues,
      count(*) filter (where coalesce(v.votes, 0) = 0)::int as zero_vote_issues,
      coalesce(sum(v.votes), 0)::int as accepted_votes,
      coalesce(max(v.votes), 0)::int as top_issue_votes
    from active a
    left join exposure e on e.issue_id = a.issue_id
    left join accepted v on v.issue_id = a.issue_id
  `);
  const totals = activity.rows[0] ?? {
    active_issues: 0,
    zero_exposure_issues: 0,
    zero_vote_issues: 0,
    accepted_votes: 0,
    top_issue_votes: 0,
  };
  return {
    windowDays: days,
    activeIssues: totals.active_issues,
    activeIssuesByCategory: categories.rows,
    zeroExposureIssues: totals.zero_exposure_issues,
    zeroAcceptedVoteIssues: totals.zero_vote_issues,
    topIssueVoteConcentration: ratio(totals.top_issue_votes, totals.accepted_votes),
  };
}

async function readExperimentPreRegistration() {
  const path = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../content/experiments/which-50-next-issue-cta-v1.json",
  );
  return experimentPreRegistrationSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

export async function readMeasurementBaseline(database: Database["db"], days: number) {
  const [funnel, reconciliation, contentSupply, experiment] = await Promise.all([
    readAnalyticsSummary(database, days),
    readAnalyticsReconciliation(database, days),
    readContentSupplySummary(database, days),
    readExperimentPreRegistration(),
  ]);
  const status =
    funnel.metrics.qualifiedSessions === 0
      ? "INSUFFICIENT_DATA"
      : reconciliation.voteAggregateProjection.mismatchedIssues > 0
        ? "DEGRADED"
        : "READY";
  return {
    schemaVersion: 1,
    status,
    generatedAt: new Date().toISOString(),
    funnel,
    reconciliation,
    contentSupply,
    experimentPreRegistration: experiment,
    interpretationLimits: [
      "배포 전에 생성된 UNCLASSIFIED Session은 공식 지표에서 제외됩니다.",
      "Member 구분은 BFF 요청 시점의 서명 Session Cookie 존재 여부를 사용하며 같은 Session 내 로그인은 Member로 승격됩니다.",
      "기기 정보는 원본 User-Agent를 저장하지 않고 MOBILE/TABLET/DESKTOP 범주로만 보존합니다.",
      "원시 Event 보존 기간은 90일이므로 공식 기준선 조회 기간도 최대 90일입니다.",
    ],
  };
}

async function main() {
  const command = process.argv[2] ?? "summary";
  const database = createDatabase(getConfig().databaseUrl);
  try {
    if (command === "aggregate") {
      await refreshAnalyticsDailyMetrics(database.db);
      console.log(JSON.stringify({ status: "ok", command }, null, 2));
      return;
    }
    if (command === "retention") {
      console.log(
        JSON.stringify(
          { status: "ok", command, ...(await applyAnalyticsRetention(database.db)) },
          null,
          2,
        ),
      );
      return;
    }
    if (command === "summary") {
      const days = Number.parseInt(process.argv[3] ?? "30", 10);
      console.log(JSON.stringify(await readAnalyticsSummary(database.db, days), null, 2));
      return;
    }
    if (command === "reconcile") {
      const days = Number.parseInt(process.argv[3] ?? "30", 10);
      console.log(JSON.stringify(await readAnalyticsReconciliation(database.db, days), null, 2));
      return;
    }
    if (command === "quality") {
      const days = Number.parseInt(process.argv[3] ?? "30", 10);
      console.log(JSON.stringify(await readAnalyticsQualitySummary(database.db, days), null, 2));
      return;
    }
    if (command === "baseline") {
      const days = Number.parseInt(process.argv[3] ?? "30", 10);
      console.log(JSON.stringify(await readMeasurementBaseline(database.db, days), null, 2));
      return;
    }
    throw new Error(
      "Usage: analytics-operator <summary [days]|quality [days]|reconcile [days]|baseline [days]|aggregate|retention>",
    );
  } finally {
    await database.close();
  }
}

if (
  process.argv[1]?.endsWith("analytics-operator.ts") ||
  process.argv[1]?.endsWith("analytics-operator.js")
) {
  await main();
}
