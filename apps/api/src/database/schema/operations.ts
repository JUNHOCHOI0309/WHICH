import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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

import { members } from "./identity.js";
import { issueMediaAssets } from "./issue-media.js";

export const operatorAccessGrants = pgTable(
  "operator_access_grants",
  {
    id: uuid("operator_access_grant_id").defaultRandom().primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    role: varchar("role", { length: 32 }).default("OPERATOR").notNull(),
    grantedBy: varchar("granted_by", { length: 128 }).notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("operator_access_grants_active_member_unique")
      .on(table.memberId)
      .where(sql`${table.revokedAt} is null`),
    index("operator_access_grants_member_updated_idx").on(table.memberId, table.updatedAt),
    check("operator_access_grants_role_check", sql`${table.role} = 'OPERATOR'`),
    check(
      "operator_access_grants_revocation_check",
      sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.grantedAt}`,
    ),
  ],
);

export const operatorAuditLogs = pgTable(
  "operator_audit_logs",
  {
    id: uuid("operator_audit_log_id").defaultRandom().primaryKey(),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    outcome: varchar("outcome", { length: 24 }).notNull(),
    requestId: varchar("request_id", { length: 128 }),
    windowDays: integer("window_days"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("operator_audit_logs_member_occurred_idx").on(table.memberId, table.occurredAt),
    index("operator_audit_logs_event_occurred_idx").on(table.eventType, table.occurredAt),
    check(
      "operator_audit_logs_outcome_check",
      sql`${table.outcome} in ('ALLOWED', 'DENIED', 'SUCCEEDED', 'FAILED')`,
    ),
    check(
      "operator_audit_logs_window_check",
      sql`${table.windowDays} is null or ${table.windowDays} in (1, 7, 30)`,
    ),
  ],
);

export const operatorBackupConfirmations = pgTable(
  "operator_backup_confirmations",
  {
    id: uuid("operator_backup_confirmation_id").defaultRandom().primaryKey(),
    confirmedByMemberId: uuid("confirmed_by_member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    backupReference: varchar("backup_reference", { length: 256 }).notNull(),
    notes: varchar("notes", { length: 500 }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("operator_backup_confirmations_confirmed_idx").on(table.confirmedAt)],
);

export const operatorEditorialDecisions = pgTable(
  "operator_editorial_decisions",
  {
    id: uuid("operator_editorial_decision_id").defaultRandom().primaryKey(),
    catalogId: varchar("catalog_id", { length: 128 }).notNull(),
    candidateId: varchar("candidate_id", { length: 32 }).notNull(),
    status: varchar("status", { length: 24 }).notNull(),
    note: text("note").default("").notNull(),
    reviewedByMemberId: uuid("reviewed_by_member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    binaryFit: boolean("binary_fit").default(false).notNull(),
    choiceParity: boolean("choice_parity").default(false).notNull(),
    duplicateReview: boolean("duplicate_review").default(false).notNull(),
    sourceReview: boolean("source_review").default(false).notNull(),
    revision: integer("revision").default(1).notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("operator_editorial_decisions_catalog_candidate_unique").on(
      table.catalogId,
      table.candidateId,
    ),
    index("operator_editorial_decisions_status_updated_idx").on(table.status, table.updatedAt),
    check(
      "operator_editorial_decisions_status_check",
      sql`${table.status} in ('APPROVED', 'NEEDS_CHANGES', 'REJECTED')`,
    ),
    check("operator_editorial_decisions_revision_check", sql`${table.revision} > 0`),
    check(
      "operator_editorial_decisions_approved_checks_check",
      sql`${table.status} <> 'APPROVED' or (
        ${table.binaryFit} and ${table.choiceParity} and ${table.duplicateReview} and ${table.sourceReview}
      )`,
    ),
  ],
);

export const operatorEditorialCandidates = pgTable(
  "operator_editorial_candidates",
  {
    id: uuid("operator_editorial_candidate_id").defaultRandom().primaryKey(),
    catalogId: varchar("catalog_id", { length: 128 }).notNull(),
    candidateId: varchar("candidate_id", { length: 32 }).notNull(),
    question: varchar("question", { length: 200 }).notNull(),
    context: varchar("context", { length: 500 }).notNull(),
    choices: jsonb("choices")
      .$type<Array<{ id: string; code: "A" | "B"; label: string }>>()
      .notNull(),
    categoryCode: varchar("category_code", { length: 64 }).notNull(),
    interestCardCode: varchar("interest_card_code", { length: 64 }).notNull(),
    editorialArea: varchar("editorial_area", { length: 64 }).notNull(),
    inventoryScope: varchar("inventory_scope", { length: 24 }).default("ACTIVE").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    createdByMemberId: uuid("created_by_member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("operator_editorial_candidates_catalog_candidate_unique").on(
      table.catalogId,
      table.candidateId,
    ),
    index("operator_editorial_candidates_created_idx").on(table.createdAt, table.candidateId),
    check(
      "operator_editorial_candidates_inventory_scope_check",
      sql`${table.inventoryScope} in ('ACTIVE', 'RESERVE', 'LONG_TERM')`,
    ),
    check(
      "operator_editorial_candidates_content_hash_check",
      sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);

export const operatorEditorialCandidateMedia = pgTable(
  "operator_editorial_candidate_media",
  {
    id: uuid("operator_editorial_candidate_media_id").defaultRandom().primaryKey(),
    catalogId: varchar("catalog_id", { length: 128 }).notNull(),
    candidateId: varchar("candidate_id", { length: 32 }).notNull(),
    choiceCode: varchar("choice_code", { length: 1 }).notNull(),
    targetIssueId: uuid("target_issue_id").notNull(),
    targetIssueVersion: integer("target_issue_version").notNull(),
    targetChoiceId: uuid("target_choice_id").notNull(),
    mediaAssetId: uuid("media_asset_id")
      .notNull()
      .references(() => issueMediaAssets.id, { onDelete: "restrict" }),
    altText: varchar("alt_text", { length: 300 }).notNull(),
    cropMode: varchar("crop_mode", { length: 16 }).default("COVER").notNull(),
    linkedByMemberId: uuid("linked_by_member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("operator_editorial_candidate_media_choice_unique").on(
      table.catalogId,
      table.candidateId,
      table.choiceCode,
    ),
    unique("operator_editorial_candidate_media_target_choice_unique").on(
      table.targetIssueId,
      table.targetIssueVersion,
      table.targetChoiceId,
    ),
    index("operator_editorial_candidate_media_candidate_idx").on(
      table.catalogId,
      table.candidateId,
    ),
    check(
      "operator_editorial_candidate_media_choice_code_check",
      sql`${table.choiceCode} in ('A', 'B', 'C', 'D')`,
    ),
    check(
      "operator_editorial_candidate_media_alt_text_check",
      sql`char_length(${table.altText}) between 2 and 300`,
    ),
    check(
      "operator_editorial_candidate_media_crop_mode_check",
      sql`${table.cropMode} in ('COVER', 'CONTAIN')`,
    ),
    check(
      "operator_editorial_candidate_media_target_version_check",
      sql`${table.targetIssueVersion} > 0`,
    ),
  ],
);
