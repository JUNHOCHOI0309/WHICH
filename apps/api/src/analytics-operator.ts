import { resolve } from "node:path";

import { config as loadEnvironment } from "dotenv";
import { sql } from "drizzle-orm";

import { getConfig } from "./config.js";
import { createDatabase, type Database } from "./database/client.js";

loadEnvironment({
  path: [resolve(process.cwd(), "../../.env.local"), resolve(process.cwd(), "../../.env")],
  quiet: true,
});

const RAW_RETENTION_DAYS = 90;

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

export async function readAnalyticsSummary(database: Database["db"], days: number) {
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
      if (!Number.isInteger(days) || days < 1 || days > 3650) {
        throw new Error("Summary days must be an integer between 1 and 3650.");
      }
      console.log(JSON.stringify(await readAnalyticsSummary(database.db, days), null, 2));
      return;
    }
    throw new Error("Usage: analytics-operator <summary [days]|aggregate|retention>");
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
