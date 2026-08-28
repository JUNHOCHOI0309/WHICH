import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { comments } from "./comments.js";
import {
  commentIntegrityStateEnum,
  commentModerationActionEnum,
  commentModerationSourceEnum,
  commentPublicationStateEnum,
  commentReportReasonEnum,
  commentVisibilityEnum,
} from "./enums.js";
import { voterSubjects } from "./subjects.js";

export const reportCases = pgTable(
  "report_cases",
  {
    id: uuid("report_case_id").defaultRandom().primaryKey(),
    targetType: varchar("target_type", { length: 24 }).notNull(),
    targetId: uuid("target_id").notNull(),
    status: varchar("status", { length: 24 }).default("OPEN").notNull(),
    priority: varchar("priority", { length: 16 }).default("NORMAL").notNull(),
    automationRecommendation: varchar("automation_recommendation", { length: 32 })
      .default("NONE")
      .notNull(),
    policyVersion: varchar("policy_version", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("report_cases_active_target_unique")
      .on(table.targetType, table.targetId)
      .where(sql`${table.status} in ('OPEN', 'QUARANTINED', 'PENDING_REVIEW')`),
    index("report_cases_status_updated_idx").on(table.status, table.updatedAt),
    check("report_cases_target_type_check", sql`${table.targetType} in ('ISSUE', 'ISSUE_MEDIA')`),
    check(
      "report_cases_status_check",
      sql`${table.status} in ('OPEN', 'QUARANTINED', 'PENDING_REVIEW', 'RESOLVED', 'DISMISSED')`,
    ),
    check("report_cases_priority_check", sql`${table.priority} in ('NORMAL', 'P0')`),
    check(
      "report_cases_automation_check",
      sql`${table.automationRecommendation} in ('NONE', 'P0_REVIEW', 'QUARANTINE_REVIEW')`,
    ),
    check(
      "report_cases_resolution_check",
      sql`(${table.status} in ('RESOLVED', 'DISMISSED') and ${table.resolvedAt} is not null)
        or (${table.status} not in ('RESOLVED', 'DISMISSED') and ${table.resolvedAt} is null)`,
    ),
  ],
);

export const reportClusters = pgTable(
  "report_clusters",
  {
    id: uuid("report_cluster_id").defaultRandom().primaryKey(),
    caseId: uuid("report_case_id")
      .notNull()
      .references(() => reportCases.id, { onDelete: "restrict" }),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    windowMinutes: integer("window_minutes").default(15).notNull(),
    classification: varchar("classification", { length: 32 }).default("BASELINE").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("report_clusters_case_window_unique").on(table.caseId, table.windowStartedAt),
    index("report_clusters_classification_updated_idx").on(table.classification, table.updatedAt),
    check("report_clusters_window_check", sql`${table.windowMinutes} = 15`),
    check(
      "report_clusters_classification_check",
      sql`${table.classification} in ('BASELINE', 'CONCENTRATED', 'COORDINATED_SUSPECTED')`,
    ),
  ],
);

export const contentReports = pgTable(
  "content_reports",
  {
    id: uuid("content_report_id").defaultRandom().primaryKey(),
    caseId: uuid("report_case_id")
      .notNull()
      .references(() => reportCases.id, { onDelete: "restrict" }),
    clusterId: uuid("report_cluster_id")
      .notNull()
      .references(() => reportClusters.id, { onDelete: "restrict" }),
    targetType: varchar("target_type", { length: 24 }).notNull(),
    targetId: uuid("target_id").notNull(),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => voterSubjects.id, { onDelete: "restrict" }),
    originSubjectId: uuid("origin_subject_id")
      .notNull()
      .references(() => voterSubjects.id, { onDelete: "restrict" }),
    reporterKind: varchar("reporter_kind", { length: 24 }).notNull(),
    reasonCode: varchar("reason_code", { length: 64 }).notNull(),
    detail: text("detail"),
    weightSnapshot: integer("weight_snapshot").notNull(),
    accountAgeDays: integer("account_age_days").notNull(),
    counted: boolean("counted").default(true).notNull(),
    mergedIntoReportId: uuid("merged_into_report_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("content_reports_counted_target_subject_unique")
      .on(table.targetType, table.targetId, table.subjectId)
      .where(sql`${table.counted} = true`),
    foreignKey({
      columns: [table.mergedIntoReportId],
      foreignColumns: [table.id],
      name: "content_reports_merged_into_fk",
    }).onDelete("restrict"),
    index("content_reports_case_created_idx").on(table.caseId, table.createdAt),
    index("content_reports_subject_created_idx").on(table.subjectId, table.createdAt),
    check(
      "content_reports_target_type_check",
      sql`${table.targetType} in ('ISSUE', 'ISSUE_MEDIA')`,
    ),
    check(
      "content_reports_reporter_kind_check",
      sql`${table.reporterKind} in ('GUEST', 'MEMBER', 'VERIFIED_MEMBER')`,
    ),
    check("content_reports_weight_check", sql`${table.weightSnapshot} in (1, 2)`),
    check("content_reports_account_age_check", sql`${table.accountAgeDays} >= 0`),
    check(
      "content_reports_merge_shape_check",
      sql`(${table.counted} = true and ${table.mergedIntoReportId} is null)
        or (${table.counted} = false and ${table.mergedIntoReportId} is not null)`,
    ),
  ],
);

export const contentReportAttempts = pgTable(
  "content_report_attempts",
  {
    id: uuid("content_report_attempt_id").primaryKey(),
    targetType: varchar("target_type", { length: 24 }).notNull(),
    targetId: uuid("target_id").notNull(),
    actorSubjectId: uuid("actor_subject_id")
      .notNull()
      .references(() => voterSubjects.id, { onDelete: "restrict" }),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    responseSnapshot: jsonb("response_snapshot").$type<Record<string, unknown>>(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("content_report_attempts_actor_received_idx").on(table.actorSubjectId, table.receivedAt),
    check(
      "content_report_attempts_target_type_check",
      sql`${table.targetType} in ('ISSUE', 'ISSUE_MEDIA')`,
    ),
  ],
);

export const reportSignalSnapshots = pgTable(
  "report_signal_snapshots",
  {
    id: uuid("report_signal_snapshot_id").defaultRandom().primaryKey(),
    caseId: uuid("report_case_id")
      .notNull()
      .references(() => reportCases.id, { onDelete: "restrict" }),
    clusterId: uuid("report_cluster_id")
      .notNull()
      .references(() => reportClusters.id, { onDelete: "restrict" }),
    reportId: uuid("content_report_id")
      .notNull()
      .references(() => contentReports.id, { onDelete: "restrict" }),
    reporterCount: integer("reporter_count").notNull(),
    weightedScore: integer("weighted_score").notNull(),
    reports15m: integer("reports_15m").notNull(),
    reports24h: integer("reports_24h").notNull(),
    velocityPerHour: integer("velocity_per_hour").notNull(),
    guestRatioBps: integer("guest_ratio_bps").notNull(),
    newAccountRatioBps: integer("new_account_ratio_bps").notNull(),
    uniqueOriginCount: integer("unique_origin_count").notNull(),
    clusterClassification: varchar("cluster_classification", { length: 32 }).notNull(),
    shadowOnly: boolean("shadow_only").default(true).notNull(),
    policyVersion: varchar("policy_version", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("report_signal_snapshots_case_created_idx").on(table.caseId, table.createdAt),
    check(
      "report_signal_snapshots_nonnegative_check",
      sql`${table.reporterCount} >= 0 and ${table.weightedScore} >= 0 and ${table.reports15m} >= 0
        and ${table.reports24h} >= 0 and ${table.velocityPerHour} >= 0
        and ${table.uniqueOriginCount} >= 0`,
    ),
    check(
      "report_signal_snapshots_ratio_check",
      sql`${table.guestRatioBps} between 0 and 10000 and ${table.newAccountRatioBps} between 0 and 10000`,
    ),
    check("report_signal_snapshots_shadow_check", sql`${table.shadowOnly} = true`),
  ],
);

export const reporterSignalSnapshots = pgTable(
  "reporter_signal_snapshots",
  {
    id: uuid("reporter_signal_snapshot_id").defaultRandom().primaryKey(),
    reportId: uuid("content_report_id")
      .notNull()
      .references(() => contentReports.id, { onDelete: "restrict" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => voterSubjects.id, { onDelete: "restrict" }),
    reports30d: integer("reports_30d").notNull(),
    mergedDuplicates30d: integer("merged_duplicates_30d").notNull(),
    accountAgeDays: integer("account_age_days").notNull(),
    signalBand: varchar("signal_band", { length: 24 }).default("UNKNOWN").notNull(),
    shadowOnly: boolean("shadow_only").default(true).notNull(),
    policyVersion: varchar("policy_version", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("reporter_signal_snapshots_subject_created_idx").on(table.subjectId, table.createdAt),
    check(
      "reporter_signal_snapshots_counts_check",
      sql`${table.reports30d} >= 0 and ${table.mergedDuplicates30d} >= 0 and ${table.accountAgeDays} >= 0`,
    ),
    check(
      "reporter_signal_snapshots_band_check",
      sql`${table.signalBand} in ('UNKNOWN', 'ESTABLISHING', 'RELIABLE', 'ABUSE_SUSPECTED')`,
    ),
    check("reporter_signal_snapshots_shadow_check", sql`${table.shadowOnly} = true`),
  ],
);

export const commentReports = pgTable(
  "comment_reports",
  {
    id: uuid("comment_report_id").defaultRandom().primaryKey(),
    commentId: uuid("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "restrict" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => voterSubjects.id, { onDelete: "restrict" }),
    originSubjectId: uuid("origin_subject_id")
      .notNull()
      .references(() => voterSubjects.id, { onDelete: "restrict" }),
    reason: commentReportReasonEnum("reason").notNull(),
    detail: text("detail"),
    weight: integer("weight").notNull(),
    counted: boolean("counted").default(true).notNull(),
    mergedIntoReportId: uuid("merged_into_report_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("comment_reports_comment_subject_unique").on(table.commentId, table.subjectId),
    foreignKey({
      columns: [table.mergedIntoReportId],
      foreignColumns: [table.id],
      name: "comment_reports_merged_into_fk",
    }).onDelete("restrict"),
    index("comment_reports_counted_comment_idx")
      .on(table.commentId, table.createdAt)
      .where(sql`${table.counted} = true`),
    index("comment_reports_subject_created_idx").on(table.subjectId, table.createdAt),
    check("comment_reports_weight_check", sql`${table.weight} in (1, 2)`),
    check(
      "comment_reports_merge_shape_check",
      sql`(${table.counted} = true and ${table.mergedIntoReportId} is null)
        or (${table.counted} = false and ${table.mergedIntoReportId} is not null)`,
    ),
    check(
      "comment_reports_not_self_merged_check",
      sql`${table.mergedIntoReportId} is null or ${table.mergedIntoReportId} <> ${table.id}`,
    ),
  ],
);

export const commentReportAttempts = pgTable(
  "comment_report_attempts",
  {
    id: uuid("comment_report_attempt_id").primaryKey(),
    commentId: uuid("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "restrict" }),
    actorSubjectId: uuid("actor_subject_id")
      .notNull()
      .references(() => voterSubjects.id, { onDelete: "restrict" }),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    responseSnapshot: jsonb("response_snapshot").$type<Record<string, unknown>>(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("comment_report_attempts_actor_received_idx").on(table.actorSubjectId, table.receivedAt),
  ],
);

export const commentModerationDecisions = pgTable(
  "comment_moderation_decisions",
  {
    id: uuid("comment_moderation_decision_id").defaultRandom().primaryKey(),
    commentId: uuid("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    action: commentModerationActionEnum("action").notNull(),
    source: commentModerationSourceEnum("source").notNull(),
    reasonCode: varchar("reason_code", { length: 64 }).notNull(),
    fromPublicationState: commentPublicationStateEnum("from_publication_state").notNull(),
    toPublicationState: commentPublicationStateEnum("to_publication_state").notNull(),
    fromVisibility: commentVisibilityEnum("from_visibility").notNull(),
    toVisibility: commentVisibilityEnum("to_visibility").notNull(),
    fromIntegrityState: commentIntegrityStateEnum("from_integrity_state").notNull(),
    toIntegrityState: commentIntegrityStateEnum("to_integrity_state").notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("comment_moderation_decisions_comment_revision_unique").on(
      table.commentId,
      table.revision,
    ),
    index("comment_moderation_decisions_comment_decided_idx").on(table.commentId, table.decidedAt),
    check("comment_moderation_decisions_revision_check", sql`${table.revision} > 0`),
  ],
);
