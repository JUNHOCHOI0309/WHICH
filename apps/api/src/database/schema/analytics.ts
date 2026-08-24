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
import { recommendationRequests } from "./recommendations.js";
import { shareCards } from "./shares.js";

export const analyticsSessions = pgTable(
  "analytics_sessions",
  {
    id: uuid("analytics_session_id").primaryKey(),
    attributionSource: varchar("attribution_source", { length: 32 }),
    attributionMedium: varchar("attribution_medium", { length: 32 }),
    attributionCampaign: varchar("attribution_campaign", { length: 64 }),
    attributionContent: varchar("attribution_content", { length: 96 }),
    attributionCapturedAt: timestamp("attribution_captured_at", { withTimezone: true }),
    entrySurface: varchar("entry_surface", { length: 24 }).default("UNKNOWN").notNull(),
    audienceSegment: varchar("audience_segment", { length: 16 }).default("UNKNOWN").notNull(),
    deviceSegment: varchar("device_segment", { length: 16 }).default("UNKNOWN").notNull(),
    trafficClass: varchar("traffic_class", { length: 16 }).default("UNCLASSIFIED").notNull(),
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
    check(
      "analytics_sessions_context_check",
      sql`${table.entrySurface} in ('HOME', 'EXTERNAL', 'DIRECT_ISSUE', 'NATIVE', 'UNKNOWN')
        and ${table.audienceSegment} in ('GUEST', 'MEMBER', 'UNKNOWN')
        and ${table.deviceSegment} in ('MOBILE', 'TABLET', 'DESKTOP', 'UNKNOWN')
        and ${table.trafficClass} in ('PRODUCT', 'TEST', 'OPERATOR', 'BOT', 'UNCLASSIFIED')`,
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
    recommendationRequestId: uuid("recommendation_request_id").references(
      () => recommendationRequests.id,
      { onDelete: "set null" },
    ),
    shareCardId: uuid("share_card_id").references(() => shareCards.id, {
      onDelete: "set null",
    }),
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
      sql`${table.eventType} in ('ISSUE_VIEWABLE_IMPRESSION', 'VOTE_SUBMIT', 'RESULT_VIEW', 'NEXT_ISSUE_OPEN', 'NEXT_ISSUE_EXHAUSTED', 'INTEREST_PROMPT_VIEW', 'INTEREST_SELECTION_COMPLETE', 'INTEREST_PROMPT_SKIP', 'INTEREST_PROFILE_RESET', 'PERSONALIZED_FEED_VIEW', 'PERSONALIZED_ISSUE_OPEN', 'SHARE_OPEN', 'SHARE_CHOICE_TOGGLE', 'SHARE_COMPLETE')`,
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

export const analyticsDailyFunnelMetrics = pgTable(
  "analytics_daily_funnel_metrics_v2",
  {
    metricDate: date("metric_date").notNull(),
    source: varchar("source", { length: 32 }).notNull(),
    medium: varchar("medium", { length: 32 }).notNull(),
    entrySurface: varchar("entry_surface", { length: 24 }).notNull(),
    audienceSegment: varchar("audience_segment", { length: 16 }).notNull(),
    deviceSegment: varchar("device_segment", { length: 16 }).notNull(),
    qualifiedSessions: integer("qualified_sessions").default(0).notNull(),
    submitSessions: integer("submit_sessions").default(0).notNull(),
    acceptedVoteSessions: integer("accepted_vote_sessions").default(0).notNull(),
    acceptedVotes: integer("accepted_votes").default(0).notNull(),
    resultSessions: integer("result_sessions").default(0).notNull(),
    nextIssueSessions: integer("next_issue_sessions").default(0).notNull(),
    secondVoteSessions: integer("second_vote_sessions").default(0).notNull(),
    exhaustedSessions: integer("exhausted_sessions").default(0).notNull(),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.metricDate,
        table.source,
        table.medium,
        table.entrySurface,
        table.audienceSegment,
        table.deviceSegment,
      ],
      name: "analytics_daily_funnel_metrics_v2_pk",
    }),
  ],
);
