import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { members } from "./identity.js";

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
