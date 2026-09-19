import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { RadarObservation } from "../../modules/radar/contracts.js";
import { issueVersions } from "./issues.js";

const instant = (name: string) => timestamp(name, { withTimezone: true });

// Catalog identity only: presence in this table does NOT grant collection rights.
export const radarSources = pgTable(
  "radar_sources",
  {
    code: varchar("source_code", { length: 32 }).primaryKey(),
  },
  (t) => [
    check(
      "radar_sources_code_check",
      sql`${t.code} in ('GOOGLE_TRENDING_RSS', 'NAVER_SEARCH', 'NAVER_DATALAB', 'YOUTUBE_DATA_API')`,
    ),
  ],
);

export const radarTopics = pgTable(
  "radar_topics",
  {
    id: uuid("topic_id").primaryKey(),
    name: varchar("name", { length: 500 }).notNull(),
    createdAt: instant("created_at").defaultNow().notNull(),
  },
  (t) => [check("radar_topics_name_check", sql`length(trim(${t.name})) > 0`)],
);

export const radarEvents = pgTable(
  "radar_events",
  {
    id: uuid("event_id").primaryKey(),
    title: varchar("title", { length: 500 }).notNull(),
    occurredAt: instant("occurred_at"),
    timePrecision: varchar("time_precision", { length: 16 }).notNull(),
    createdAt: instant("created_at").defaultNow().notNull(),
  },
  (t) => [
    check("radar_events_title_check", sql`length(trim(${t.title})) > 0`),
    check(
      "radar_events_time_check",
      sql`(${t.timePrecision} = 'UNKNOWN' and ${t.occurredAt} is null) or (${t.timePrecision} in ('EXACT','DAY') and ${t.occurredAt} is not null)`,
    ),
    index("radar_events_occurred_idx").on(t.occurredAt),
  ],
);

export const radarEventTopics = pgTable(
  "radar_event_topics",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => radarEvents.id, { onDelete: "cascade" }),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => radarTopics.id, { onDelete: "restrict" }),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.topicId] }),
    index("radar_event_topics_topic_idx").on(t.topicId, t.eventId),
  ],
);

export const radarEvidence = pgTable(
  "radar_evidence",
  {
    id: uuid("evidence_id").primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => radarEvents.id, { onDelete: "cascade" }),
    source: varchar("source_code", { length: 32 })
      .notNull()
      .references(() => radarSources.code, { onDelete: "restrict" }),
    sourceUrl: varchar("source_url", { length: 8192 }).notNull(),
    claim: varchar("claim", { length: 500 }).notNull(),
    publishedAt: instant("published_at"),
    observedAt: instant("observed_at").notNull(),
    expiresAt: instant("expires_at").notNull(),
    status: varchar("status", { length: 16 }).notNull(),
  },
  (t) => [
    check("radar_evidence_claim_check", sql`length(trim(${t.claim})) > 0`),
    check("radar_evidence_url_check", sql`${t.sourceUrl} ~ '^https://[^/@[:space:]]+([/?#]|$)'`),
    check(
      "radar_evidence_status_check",
      sql`${t.status} in ('SUPPORTED','PARTIAL','CONFLICTED','UNKNOWN','RETRACTED')`,
    ),
    check(
      "radar_evidence_expiry_check",
      sql`${t.expiresAt} > ${t.observedAt} and ${t.expiresAt} <= ${t.observedAt} + interval '24 hours'`,
    ),
    index("radar_evidence_event_time_idx").on(t.eventId, t.observedAt),
    index("radar_evidence_source_time_idx").on(t.source, t.observedAt),
    index("radar_evidence_expiry_idx").on(t.expiresAt),
  ],
);

export const radarObservations = pgTable(
  "radar_observations",
  {
    id: uuid("observation_id").defaultRandom().primaryKey(),
    observationKey: varchar("observation_key", { length: 64 }).notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    source: varchar("source_code", { length: 32 })
      .notNull()
      .references(() => radarSources.code, { onDelete: "restrict" }),
    sourceItemId: varchar("source_item_id", { length: 500 }).notNull(),
    sourceUrl: varchar("source_url", { length: 8192 }).notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    metricName: varchar("metric_name", { length: 500 }).notNull(),
    countryCode: varchar("country_code", { length: 2 }).notNull(),
    queryKey: varchar("query_key", { length: 500 }).notNull(),
    dimensionsKey: varchar("dimensions_key", { length: 500 }).notNull(),
    windowStart: instant("window_start").notNull(),
    windowEnd: instant("window_end").notNull(),
    granularity: varchar("granularity", { length: 16 }).notNull(),
    sampledAt: instant("sampled_at").notNull(),
    sourceUpdatedAt: instant("source_updated_at"),
    metricKind: varchar("metric_kind", { length: 24 }).notNull(),
    metricValue: doublePrecision("metric_value"),
    comparisonKey: varchar("comparison_key", { length: 500 }),
    fetchedAt: instant("fetched_at").notNull(),
    expiresAt: instant("expires_at").notNull(),
  },
  (t) => [
    unique("radar_observations_key_unique").on(t.observationKey),
    check(
      "radar_observations_hash_check",
      sql`${t.observationKey} ~ '^[0-9a-f]{64}$' and ${t.contentHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "radar_observations_text_check",
      sql`length(trim(${t.title})) > 0 and length(trim(${t.sourceItemId})) > 0 and length(trim(${t.metricName})) > 0 and length(trim(${t.queryKey})) > 0 and length(trim(${t.dimensionsKey})) > 0`,
    ),
    check(
      "radar_observations_url_check",
      sql`${t.sourceUrl} ~ '^https://[^/@[:space:]]+([/?#]|$)'`,
    ),
    check("radar_observations_country_check", sql`${t.countryCode} ~ '^[A-Z]{2}$'`),
    check(
      "radar_observations_window_check",
      sql`${t.windowEnd} >= ${t.windowStart} and ${t.granularity} in ('SNAPSHOT','HOUR','DAY','WEEK','MONTH')`,
    ),
    check(
      "radar_observations_metric_check",
      sql`
    (${t.metricKind} in ('COUNT','LOWER_BOUND') and ${t.comparisonKey} is null and
      (${t.metricValue} is null or (${t.metricValue} >= 0 and ${t.metricValue} <= 9007199254740991 and ${t.metricValue} = floor(${t.metricValue})))) or
    (${t.metricKind} = 'RANK' and ${t.comparisonKey} is not null and length(trim(${t.comparisonKey})) > 0 and
      (${t.metricValue} is null or (${t.metricValue} >= 1 and ${t.metricValue} <= 9007199254740991 and ${t.metricValue} = floor(${t.metricValue})))) or
    (${t.metricKind} = 'RELATIVE_INDEX' and ${t.comparisonKey} is not null and length(trim(${t.comparisonKey})) > 0 and
      (${t.metricValue} is null or (${t.metricValue} >= 0 and ${t.metricValue} <= 100)))`,
    ),
    check(
      "radar_observations_expiry_check",
      sql`${t.expiresAt} > ${t.fetchedAt} and ${t.expiresAt} <= ${t.fetchedAt} + interval '24 hours'`,
    ),
    index("radar_observations_source_sample_idx").on(t.source, t.sampledAt),
    index("radar_observations_source_window_idx").on(t.source, t.windowStart, t.windowEnd),
    index("radar_observations_item_idx").on(t.source, t.sourceItemId),
    index("radar_observations_expiry_idx").on(t.expiresAt),
  ],
);

export const radarObservationRevisions = pgTable(
  "radar_observation_revisions",
  {
    observationId: uuid("observation_id")
      .notNull()
      .references(() => radarObservations.id, { onDelete: "cascade" }),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    payload: jsonb("payload").$type<RadarObservation>().notNull(),
    recordedAt: instant("recorded_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.observationId, t.contentHash] }),
    check("radar_revisions_hash_check", sql`${t.contentHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const radarEventObservations = pgTable(
  "radar_event_observations",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => radarEvents.id, { onDelete: "cascade" }),
    observationId: uuid("observation_id")
      .notNull()
      .references(() => radarObservations.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.observationId] }),
    index("radar_event_observations_observation_idx").on(t.observationId),
  ],
);

export const radarIssueLinks = pgTable(
  "radar_issue_links",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => radarEvents.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id").notNull(),
    issueVersion: integer("issue_version").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.issueId, t.issueVersion] }),
    foreignKey({
      columns: [t.issueId, t.issueVersion],
      foreignColumns: [issueVersions.issueId, issueVersions.version],
      name: "radar_issue_links_version_fk",
    }).onDelete("cascade"),
    index("radar_issue_links_issue_idx").on(t.issueId, t.issueVersion),
  ],
);
