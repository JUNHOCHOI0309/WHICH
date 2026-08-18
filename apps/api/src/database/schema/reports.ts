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
