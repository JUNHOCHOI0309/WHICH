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

export const memberDailyAttendances = pgTable(
  "member_daily_attendances",
  {
    id: uuid("member_daily_attendance_id").defaultRandom().primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    operationDay: date("operation_day").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("member_daily_attendances_member_day_unique").on(table.memberId, table.operationDay),
    index("member_daily_attendances_day_idx").on(table.operationDay, table.occurredAt),
  ],
);

export const pointAccounts = pgTable(
  "point_accounts",
  {
    memberId: uuid("member_id")
      .primaryKey()
      .references(() => members.id, { onDelete: "restrict" }),
    cachedBalance: integer("cached_balance").default(0).notNull(),
    restrictedDebt: integer("restricted_debt").default(0).notNull(),
    lifetimeEarned: integer("lifetime_earned").default(0).notNull(),
    lifetimeSpent: integer("lifetime_spent").default(0).notNull(),
    version: integer("version").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("point_accounts_balance_nonnegative_check", sql`${table.cachedBalance} >= 0`),
    check("point_accounts_restricted_debt_check", sql`${table.restrictedDebt} >= 0`),
    check("point_accounts_lifetime_earned_check", sql`${table.lifetimeEarned} >= 0`),
    check("point_accounts_lifetime_spent_check", sql`${table.lifetimeSpent} >= 0`),
    check("point_accounts_version_check", sql`${table.version} >= 0`),
    index("point_accounts_updated_idx").on(table.updatedAt),
  ],
);

export const pointBadgePolicies = pgTable(
  "point_badge_policies",
  {
    policyVersion: varchar("policy_version", { length: 32 }).notNull(),
    badgeCode: varchar("badge_code", { length: 16 }).notNull(),
    label: varchar("label", { length: 32 }).notNull(),
    minimumLifetimePoints: integer("minimum_lifetime_points").notNull(),
    displayOrder: integer("display_order").notNull(),
    assetKey: varchar("asset_key", { length: 128 }).notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      columns: [table.policyVersion, table.badgeCode],
      name: "point_badge_policies_pk",
    }),
    unique("point_badge_policies_threshold_unique").on(
      table.policyVersion,
      table.minimumLifetimePoints,
    ),
    unique("point_badge_policies_order_unique").on(table.policyVersion, table.displayOrder),
    check(
      "point_badge_policies_badge_code_check",
      sql`${table.badgeCode} in ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND')`,
    ),
    check("point_badge_policies_threshold_check", sql`${table.minimumLifetimePoints} > 0`),
    check("point_badge_policies_order_check", sql`${table.displayOrder} > 0`),
    check(
      "point_badge_policies_period_check",
      sql`${table.retiredAt} is null or ${table.retiredAt} > ${table.effectiveAt}`,
    ),
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

export const memberPointBadgeAwards = pgTable(
  "member_point_badge_awards",
  {
    id: uuid("member_point_badge_award_id").defaultRandom().primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => pointAccounts.memberId, { onDelete: "restrict" }),
    badgeCode: varchar("badge_code", { length: 16 }).notNull(),
    policyVersion: varchar("policy_version", { length: 32 }).notNull(),
    thresholdSnapshot: integer("threshold_snapshot").notNull(),
    labelSnapshot: varchar("label_snapshot", { length: 32 }).notNull(),
    sourceLedgerEntryId: uuid("source_ledger_entry_id").references(() => pointLedgerEntries.id, {
      onDelete: "restrict",
    }),
    awardSource: varchar("award_source", { length: 32 }).notNull(),
    awardedAt: timestamp("awarded_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("member_point_badge_awards_member_badge_unique").on(table.memberId, table.badgeCode),
    foreignKey({
      columns: [table.policyVersion, table.badgeCode],
      foreignColumns: [pointBadgePolicies.policyVersion, pointBadgePolicies.badgeCode],
      name: "member_point_badge_awards_policy_fk",
    }).onDelete("restrict"),
    check(
      "member_point_badge_awards_source_check",
      sql`${table.awardSource} in ('LEDGER_ENTRY', 'MIGRATION_BACKFILL', 'POLICY_RECONCILIATION')`,
    ),
    check("member_point_badge_awards_threshold_check", sql`${table.thresholdSnapshot} > 0`),
    index("member_point_badge_awards_member_awarded_idx").on(table.memberId, table.awardedAt),
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

export const pointEventReceipts = pgTable(
  "point_event_receipts",
  {
    eventId: uuid("event_id").primaryKey(),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    outcome: varchar("outcome", { length: 24 }).notNull(),
    policyVersion: varchar("policy_version", { length: 32 }).notNull(),
    operationDay: date("operation_day").notNull(),
    ledgerEntryId: uuid("ledger_entry_id").references(() => pointLedgerEntries.id, {
      onDelete: "restrict",
    }),
    detail: varchar("detail", { length: 160 }),
    processedAt: timestamp("processed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "point_event_receipts_outcome_check",
      sql`${table.outcome} in ('AWARDED', 'REVERSED', 'DUPLICATE', 'CAP_REACHED', 'INELIGIBLE', 'DISABLED')`,
    ),
    index("point_event_receipts_processed_idx").on(table.processedAt),
  ],
);
