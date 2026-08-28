import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { members } from "./identity.js";

export const memberModerationNotices = pgTable(
  "member_moderation_notices",
  {
    id: uuid("member_moderation_notice_id").defaultRandom().primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    targetType: varchar("target_type", { length: 32 }).notNull(),
    targetId: uuid("target_id").notNull(),
    policyVersion: varchar("policy_version", { length: 64 }).notNull(),
    reasonCode: varchar("reason_code", { length: 64 }).notNull(),
    actionType: varchar("action_type", { length: 48 }).notNull(),
    summary: text("summary").notNull(),
    nextStep: text("next_step").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("member_moderation_notices_member_created_idx").on(table.memberId, table.createdAt),
    index("member_moderation_notices_target_created_idx").on(
      table.targetType,
      table.targetId,
      table.createdAt,
    ),
    check(
      "member_moderation_notices_target_type_check",
      sql`${table.targetType} in ('COMMENT_VERSION', 'ISSUE_VERSION', 'ISSUE_MEDIA_ASSET', 'PROFILE_VERSION')`,
    ),
    check("member_moderation_notices_summary_check", sql`char_length(${table.summary}) >= 2`),
    check("member_moderation_notices_next_step_check", sql`char_length(${table.nextStep}) >= 2`),
  ],
);

export const moderationAppeals = pgTable(
  "moderation_appeals",
  {
    id: uuid("moderation_appeal_id").defaultRandom().primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    targetType: varchar("target_type", { length: 32 }).notNull(),
    targetId: uuid("target_id").notNull(),
    reason: text("reason").notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().default({}).notNull(),
    status: varchar("status", { length: 24 }).default("SUBMITTED").notNull(),
    resolution: text("resolution"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("moderation_appeals_member_submitted_idx").on(table.memberId, table.submittedAt),
    index("moderation_appeals_status_submitted_idx").on(table.status, table.submittedAt),
    index("moderation_appeals_target_idx").on(table.targetType, table.targetId),
    check(
      "moderation_appeals_target_type_check",
      sql`${table.targetType} in ('COMMENT_VERSION', 'ISSUE_VERSION', 'ISSUE_MEDIA_ASSET', 'PROFILE_VERSION')`,
    ),
    check(
      "moderation_appeals_status_check",
      sql`${table.status} in ('SUBMITTED', 'IN_REVIEW', 'UPHELD', 'OVERTURNED', 'CANCELLED')`,
    ),
    check("moderation_appeals_reason_check", sql`char_length(${table.reason}) between 20 and 4000`),
    check(
      "moderation_appeals_resolution_check",
      sql`(${table.status} in ('SUBMITTED', 'IN_REVIEW', 'CANCELLED')) or (${table.resolvedAt} is not null and char_length(${table.resolution}) between 10 and 4000)`,
    ),
  ],
);

export const moderationRightsCases = pgTable(
  "moderation_rights_cases",
  {
    id: uuid("moderation_rights_case_id").defaultRandom().primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    requestType: varchar("request_type", { length: 24 }).notNull(),
    targetType: varchar("target_type", { length: 32 }).notNull(),
    targetId: uuid("target_id").notNull(),
    details: text("details").notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().default({}).notNull(),
    status: varchar("status", { length: 24 }).default("SUBMITTED").notNull(),
    resolution: text("resolution"),
    legalHoldUntil: timestamp("legal_hold_until", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("moderation_rights_cases_member_submitted_idx").on(table.memberId, table.submittedAt),
    index("moderation_rights_cases_status_due_idx").on(table.status, table.dueAt),
    index("moderation_rights_cases_target_idx").on(table.targetType, table.targetId),
    check(
      "moderation_rights_cases_request_type_check",
      sql`${table.requestType} in ('PRIVACY', 'DEFAMATION', 'COPYRIGHT')`,
    ),
    check(
      "moderation_rights_cases_target_type_check",
      sql`${table.targetType} in ('COMMENT_VERSION', 'ISSUE_VERSION', 'ISSUE_MEDIA_ASSET', 'PROFILE_VERSION')`,
    ),
    check(
      "moderation_rights_cases_status_check",
      sql`${table.status} in ('SUBMITTED', 'IN_REVIEW', 'ACTIONED', 'DISMISSED', 'WITHDRAWN')`,
    ),
    check(
      "moderation_rights_cases_details_check",
      sql`char_length(${table.details}) between 20 and 4000`,
    ),
    check(
      "moderation_rights_cases_resolution_check",
      sql`(${table.status} in ('SUBMITTED', 'IN_REVIEW', 'WITHDRAWN')) or (${table.resolvedAt} is not null and char_length(${table.resolution}) between 10 and 4000)`,
    ),
  ],
);
