import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { issueVersions } from "./issues.js";

export const analyticsSessions = pgTable(
  "analytics_sessions",
  {
    id: uuid("analytics_session_id").primaryKey(),
    attributionSource: varchar("attribution_source", { length: 32 }),
    attributionMedium: varchar("attribution_medium", { length: 32 }),
    attributionCampaign: varchar("attribution_campaign", { length: 64 }),
    attributionContent: varchar("attribution_content", { length: 96 }),
    attributionCapturedAt: timestamp("attribution_captured_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("analytics_sessions_last_activity_idx").on(table.lastActivityAt),
    index("analytics_sessions_attribution_idx").on(
      table.attributionSource,
      table.attributionMedium,
    ),
    check(
      "analytics_sessions_window_check",
      sql`${table.lastActivityAt} >= ${table.startedAt} and ${table.expiresAt} > ${table.lastActivityAt}`,
    ),
  ],
);

export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: uuid("event_id").primaryKey(),
    sessionId: uuid("analytics_session_id")
      .notNull()
      .references(() => analyticsSessions.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 48 }).notNull(),
    issueId: uuid("issue_id").notNull(),
    issueVersion: integer("issue_version").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.issueId, table.issueVersion],
      foreignColumns: [issueVersions.issueId, issueVersions.version],
      name: "analytics_events_issue_version_fk",
    }).onDelete("restrict"),
    index("analytics_events_session_occurred_idx").on(table.sessionId, table.occurredAt),
    index("analytics_events_type_occurred_idx").on(table.eventType, table.occurredAt),
    check(
      "analytics_events_type_check",
      sql`${table.eventType} in ('ISSUE_VIEWABLE_IMPRESSION', 'VOTE_SUBMIT', 'RESULT_VIEW', 'NEXT_ISSUE_OPEN', 'NEXT_ISSUE_EXHAUSTED', 'INTEREST_PROMPT_VIEW', 'INTEREST_SELECTION_COMPLETE', 'INTEREST_PROMPT_SKIP', 'INTEREST_PROFILE_RESET')`,
    ),
  ],
);

export const analyticsDailyMetrics = pgTable(
  "analytics_daily_metrics",
  {
    metricDate: date("metric_date").notNull(),
    source: varchar("source", { length: 32 }).notNull(),
    medium: varchar("medium", { length: 32 }).notNull(),
    campaign: varchar("campaign", { length: 64 }).notNull(),
    content: varchar("content", { length: 96 }).notNull(),
    qualifiedSessions: integer("qualified_sessions").default(0).notNull(),
    acceptedVoteSessions: integer("accepted_vote_sessions").default(0).notNull(),
    acceptedVotes: integer("accepted_votes").default(0).notNull(),
    secondVoteSessions: integer("second_vote_sessions").default(0).notNull(),
    resultViews: integer("result_views").default(0).notNull(),
    nextIssueOpens: integer("next_issue_opens").default(0).notNull(),
    nextIssueExhausted: integer("next_issue_exhausted").default(0).notNull(),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.metricDate, table.source, table.medium, table.campaign, table.content],
      name: "analytics_daily_metrics_pk",
    }),
  ],
);
