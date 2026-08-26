import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { pointLedgerEntryTypeEnum } from "./enums.js";
import { members } from "./identity.js";

export const pointAccounts = pgTable(
  "point_accounts",
  {
    memberId: uuid("member_id")
      .primaryKey()
      .references(() => members.id, { onDelete: "restrict" }),
    cachedBalance: integer("cached_balance").default(0).notNull(),
    lifetimeEarned: integer("lifetime_earned").default(0).notNull(),
    lifetimeSpent: integer("lifetime_spent").default(0).notNull(),
    version: integer("version").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("point_accounts_balance_nonnegative_check", sql`${table.cachedBalance} >= 0`),
    check("point_accounts_lifetime_earned_check", sql`${table.lifetimeEarned} >= 0`),
    check("point_accounts_lifetime_spent_check", sql`${table.lifetimeSpent} >= 0`),
    check("point_accounts_version_check", sql`${table.version} >= 0`),
    index("point_accounts_updated_idx").on(table.updatedAt),
  ],
);

export const pointLedgerEntries = pgTable(
  "point_ledger_entries",
  {
    id: uuid("point_ledger_entry_id").defaultRandom().primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => pointAccounts.memberId, { onDelete: "restrict" }),
    entryType: pointLedgerEntryTypeEnum("entry_type").notNull(),
    amount: integer("amount").notNull(),
    reasonCode: varchar("reason_code", { length: 64 }).notNull(),
    sourceType: varchar("source_type", { length: 64 }).notNull(),
    sourceId: varchar("source_id", { length: 160 }).notNull(),
    operationDay: date("operation_day").notNull(),
    reversesEntryId: uuid("reverses_entry_id"),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    policyVersion: varchar("policy_version", { length: 32 }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("point_ledger_entries_idempotency_key_unique").on(table.idempotencyKey),
    unique("point_ledger_entries_source_reason_unique").on(
      table.sourceType,
      table.sourceId,
      table.reasonCode,
    ),
    uniqueIndex("point_ledger_entries_reversal_unique")
      .on(table.reversesEntryId)
      .where(sql`${table.reversesEntryId} is not null`),
    index("point_ledger_entries_member_created_idx").on(table.memberId, table.createdAt),
    index("point_ledger_entries_operation_reason_idx").on(table.operationDay, table.reasonCode),
    foreignKey({
      columns: [table.reversesEntryId],
      foreignColumns: [table.id],
      name: "point_ledger_entries_reverses_entry_fk",
    }).onDelete("restrict"),
    check(
      "point_ledger_entries_amount_shape_check",
      sql`(
        ${table.entryType} in ('EARN', 'REFUND') and ${table.amount} > 0
      ) or (
        ${table.entryType} in ('SPEND', 'REVERSAL') and ${table.amount} < 0
      ) or (
        ${table.entryType} = 'ADJUSTMENT' and ${table.amount} <> 0
      )`,
    ),
    check(
      "point_ledger_entries_reversal_shape_check",
      sql`(${table.entryType} = 'REVERSAL' and ${table.reversesEntryId} is not null)
        or (${table.entryType} <> 'REVERSAL' and ${table.reversesEntryId} is null)`,
    ),
    check(
      "point_ledger_entries_not_self_reversal_check",
      sql`${table.reversesEntryId} is null or ${table.reversesEntryId} <> ${table.id}`,
    ),
  ],
);

export const pointDailyCounters = pgTable(
  "point_daily_counters",
  {
    memberId: uuid("member_id")
      .notNull()
      .references(() => pointAccounts.memberId, { onDelete: "restrict" }),
    operationDay: date("operation_day").notNull(),
    counterKey: varchar("counter_key", { length: 64 }).notNull(),
    qualifyingCount: integer("qualifying_count").default(0).notNull(),
    awardedPoints: integer("awarded_points").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.memberId, table.operationDay, table.counterKey],
      name: "point_daily_counters_pk",
    }),
    check("point_daily_counters_count_check", sql`${table.qualifyingCount} >= 0`),
    check("point_daily_counters_points_check", sql`${table.awardedPoints} >= 0`),
    index("point_daily_counters_day_key_idx").on(table.operationDay, table.counterKey),
  ],
);
