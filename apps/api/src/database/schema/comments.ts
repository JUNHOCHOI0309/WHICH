import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import {
  choiceCodeEnum,
  commentIntegrityStateEnum,
  commentPublicationStateEnum,
  commentThreadStateEnum,
  commentVisibilityEnum,
} from "./enums.js";
import { issues, issueVersions } from "./issues.js";
import { members } from "./identity.js";
import { voterSubjects } from "./subjects.js";
import { votes } from "./votes.js";

export const commentWriteAttempts = pgTable(
  "comment_write_attempts",
  {
    id: uuid("comment_write_attempt_id").primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "restrict" }),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    responseSnapshot: jsonb("response_snapshot").$type<Record<string, unknown>>(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("comment_write_attempts_member_received_idx").on(table.memberId, table.receivedAt),
    index("comment_write_attempts_issue_received_idx").on(table.issueId, table.receivedAt),
  ],
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("comment_id").defaultRandom().primaryKey(),
    issueId: uuid("issue_id").notNull(),
    issueVersion: integer("issue_version").notNull(),
    authorSubjectId: uuid("author_subject_id")
      .notNull()
      .references(() => voterSubjects.id, { onDelete: "restrict" }),
    acceptedVoteId: uuid("accepted_vote_id")
      .notNull()
      .references(() => votes.id, { onDelete: "restrict" }),
    choice: choiceCodeEnum("choice_snapshot").notNull(),
    parentCommentId: uuid("parent_comment_id"),
    threadRootCommentId: uuid("thread_root_comment_id"),
    authorDisplayName: varchar("author_display_name_snapshot", { length: 40 }).notNull(),
    body: text("body").notNull(),
    textPolicyVersion: varchar("text_policy_version", { length: 32 })
      .default("comment-text-v1")
      .notNull(),
    publicationState: commentPublicationStateEnum("publication_state")
      .default("PENDING_AUTOMOD")
      .notNull(),
    visibility: commentVisibilityEnum("visibility").default("VISIBLE").notNull(),
    threadState: commentThreadStateEnum("thread_state").default("OPEN").notNull(),
    integrityState: commentIntegrityStateEnum("integrity_state").default("NORMAL").notNull(),
    reportScoreBaseline: integer("report_score_baseline").default(0).notNull(),
    reporterCountBaseline: integer("reporter_count_baseline").default(0).notNull(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.issueId, table.issueVersion],
      foreignColumns: [issueVersions.issueId, issueVersions.version],
      name: "comments_issue_version_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.parentCommentId],
      foreignColumns: [table.id],
      name: "comments_parent_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.threadRootCommentId],
      foreignColumns: [table.id],
      name: "comments_thread_root_fk",
    }).onDelete("restrict"),
    index("comments_public_issue_version_created_idx").on(
      table.issueId,
      table.issueVersion,
      table.createdAt,
      table.id,
    ),
    uniqueIndex("comments_one_active_top_level_per_issue_author_unique")
      .on(table.issueId, table.authorSubjectId)
      .where(sql`${table.parentCommentId} is null and ${table.deletedAt} is null`),
    check("comments_body_not_blank_check", sql`length(btrim(${table.body})) > 0`),
    check("comments_positive_version_check", sql`${table.version} > 0`),
    check("comments_report_score_baseline_check", sql`${table.reportScoreBaseline} >= 0`),
    check("comments_reporter_count_baseline_check", sql`${table.reporterCountBaseline} >= 0`),
    check(
      "comments_thread_shape_check",
      sql`(${table.parentCommentId} is null and ${table.threadRootCommentId} is null)
        or (${table.parentCommentId} is not null and ${table.threadRootCommentId} is not null)`,
    ),
    check(
      "comments_author_delete_shape_check",
      sql`(${table.visibility} = 'REMOVED_BY_AUTHOR' and ${table.deletedAt} is not null)
        or (${table.visibility} <> 'REMOVED_BY_AUTHOR')`,
    ),
  ],
);
