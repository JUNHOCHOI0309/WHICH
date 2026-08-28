import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { members } from "./identity.js";
import { issueMediaAssets } from "./issue-media.js";

export const memberIssueSubmissions = pgTable(
  "member_issue_submissions",
  {
    id: uuid("submission_id").defaultRandom().primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    idempotencyKey: uuid("idempotency_key").notNull(),
    revision: integer("revision").default(1).notNull(),
    status: varchar("status", { length: 24 }).default("PENDING").notNull(),
    question: text("question").notNull(),
    context: text("context"),
    choiceA: text("choice_a").notNull(),
    choiceB: text("choice_b").notNull(),
    mediaAssetAId: uuid("media_asset_a_id").references(() => issueMediaAssets.id, {
      onDelete: "restrict",
    }),
    mediaAssetBId: uuid("media_asset_b_id").references(() => issueMediaAssets.id, {
      onDelete: "restrict",
    }),
    interestCardCode: varchar("interest_card_code", { length: 64 }).notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    reviewNote: varchar("review_note", { length: 2000 }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("member_issue_submissions_member_idempotency_unique").on(
      table.memberId,
      table.idempotencyKey,
    ),
    index("member_issue_submissions_member_updated_idx").on(table.memberId, table.updatedAt),
    index("member_issue_submissions_status_submitted_idx").on(table.status, table.submittedAt),
    check("member_issue_submissions_revision_check", sql`${table.revision} > 0`),
    check(
      "member_issue_submissions_status_check",
      sql`${table.status} in ('PENDING', 'APPROVED', 'NEEDS_CHANGES', 'REJECTED')`,
    ),
  ],
);

export const memberIssueSubmissionRevisions = pgTable(
  "member_issue_submission_revisions",
  {
    id: uuid("submission_revision_id").defaultRandom().primaryKey(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => memberIssueSubmissions.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    question: text("question").notNull(),
    context: text("context"),
    choiceA: text("choice_a").notNull(),
    choiceB: text("choice_b").notNull(),
    mediaAssetAId: uuid("media_asset_a_id").references(() => issueMediaAssets.id, {
      onDelete: "restrict",
    }),
    mediaAssetBId: uuid("media_asset_b_id").references(() => issueMediaAssets.id, {
      onDelete: "restrict",
    }),
    interestCardCode: varchar("interest_card_code", { length: 64 }).notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("member_issue_submission_revisions_submission_revision_unique").on(
      table.submissionId,
      table.revision,
    ),
    unique("member_issue_submission_revisions_member_idempotency_unique").on(
      table.memberId,
      table.idempotencyKey,
    ),
    index("member_issue_submission_revisions_submission_idx").on(
      table.submissionId,
      table.revision,
    ),
    check("member_issue_submission_revisions_revision_check", sql`${table.revision} > 0`),
  ],
);
