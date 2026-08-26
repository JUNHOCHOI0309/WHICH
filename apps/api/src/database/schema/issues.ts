import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import {
  choiceCodeEnum,
  feedEligibilityEnum,
  issueLifecycleEnum,
  issueParticipationEnum,
  issueVisibilityEnum,
  resultVisibilityEnum,
  riskLevelEnum,
} from "./enums.js";

export const issues = pgTable(
  "issues",
  {
    id: uuid("issue_id").defaultRandom().primaryKey(),
    successorIssueId: uuid("successor_issue_id"),
    lifecycle: issueLifecycleEnum("lifecycle").default("PUBLISHED").notNull(),
    visibility: issueVisibilityEnum("visibility").default("VISIBLE").notNull(),
    participation: issueParticipationEnum("participation").default("VOTING_OPEN").notNull(),
    resultVisibility: resultVisibilityEnum("result_visibility")
      .default("PRE_VOTE_HIDDEN")
      .notNull(),
    feedEligibility: feedEligibilityEnum("feed_eligibility").default("ELIGIBLE").notNull(),
    riskLevel: riskLevelEnum("risk_level").default("LOW").notNull(),
    isPolitical: boolean("is_political").default(false).notNull(),
    voteOpenAt: timestamp("vote_open_at", { withTimezone: true }),
    voteCloseAt: timestamp("vote_close_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.successorIssueId],
      foreignColumns: [table.id],
      name: "issues_successor_issue_fk",
    }).onDelete("set null"),
    check(
      "issues_vote_window_check",
      sql`${table.voteCloseAt} is null or ${table.voteOpenAt} is null or ${table.voteCloseAt} > ${table.voteOpenAt}`,
    ),
    check(
      "issues_political_risk_check",
      sql`not ${table.isPolitical} or ${table.riskLevel} = 'RESTRICTED'`,
    ),
  ],
);

export const issueVersions = pgTable(
  "issue_versions",
  {
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    version: integer("issue_version").notNull(),
    question: text("question").notNull(),
    context: text("context"),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    primaryCategoryCode: varchar("primary_category_code", { length: 64 }).notNull(),
    experienceModeCode: varchar("experience_mode_code", { length: 64 }).notNull(),
    formatMode: varchar("format_mode", { length: 24 }).default("VS").notNull(),
    mediaMode: varchar("media_mode", { length: 24 }).default("TEXT_ONLY").notNull(),
    taxonomyVersion: varchar("taxonomy_version", { length: 32 }).notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.issueId, table.version], name: "issue_versions_pk" }),
    check("issue_versions_positive_version_check", sql`${table.version} > 0`),
    check("issue_versions_format_mode_check", sql`${table.formatMode} in ('VS')`),
    check(
      "issue_versions_media_mode_check",
      sql`${table.mediaMode} in ('TEXT_ONLY', 'OPTION_IMAGES')`,
    ),
  ],
);

export const issueChoices = pgTable(
  "issue_choices",
  {
    id: uuid("choice_id").defaultRandom().primaryKey(),
    issueId: uuid("issue_id").notNull(),
    issueVersion: integer("issue_version").notNull(),
    code: choiceCodeEnum("choice_code").notNull(),
    label: text("label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.issueId, table.issueVersion],
      foreignColumns: [issueVersions.issueId, issueVersions.version],
      name: "issue_choices_issue_version_fk",
    }).onDelete("cascade"),
    unique("issue_choices_issue_version_code_unique").on(
      table.issueId,
      table.issueVersion,
      table.code,
    ),
    unique("issue_choices_issue_version_id_unique").on(table.issueId, table.issueVersion, table.id),
  ],
);
