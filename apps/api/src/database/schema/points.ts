import { sql } from "drizzle-orm";
import {
  boolean,
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

export const pointCatalogItems = pgTable(
  "point_catalog_items",
  {
    id: uuid("point_catalog_item_id").defaultRandom().primaryKey(),
    code: varchar("code", { length: 64 }).notNull(),
    itemType: varchar("item_type", { length: 32 }).notNull(),
    surface: varchar("surface", { length: 32 }).notNull(),
    equipSlot: varchar("equip_slot", { length: 32 }).notNull(),
    themeFamily: varchar("theme_family", { length: 32 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    description: varchar("description", { length: 280 }).notNull(),
    price: integer("price").notNull(),
    permanent: boolean("permanent").default(true).notNull(),
    saleStartAt: timestamp("sale_start_at", { withTimezone: true }),
    saleEndAt: timestamp("sale_end_at", { withTimezone: true }),
    usageEndAt: timestamp("usage_end_at", { withTimezone: true }),
    status: varchar("status", { length: 16 }).default("ACTIVE").notNull(),
    currentVersion: integer("current_version").default(1).notNull(),
    opsRevision: integer("ops_revision").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("point_catalog_items_code_unique").on(table.code),
    check("point_catalog_items_price_check", sql`${table.price} > 0`),
    check("point_catalog_items_version_check", sql`${table.currentVersion} > 0`),
    check("point_catalog_items_ops_revision_check", sql`${table.opsRevision} > 0`),
    check(
      "point_catalog_items_status_check",
      sql`${table.status} in ('ACTIVE', 'PAUSED', 'RETIRED')`,
    ),
    check(
      "point_catalog_items_sale_period_check",
      sql`${table.saleEndAt} is null or ${table.saleStartAt} is null or ${table.saleEndAt} > ${table.saleStartAt}`,
    ),
    index("point_catalog_items_listing_idx").on(table.status, table.surface, table.themeFamily),
  ],
);

export const pointCatalogItemVersions = pgTable(
  "point_catalog_item_versions",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => pointCatalogItems.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    assetManifest: jsonb("asset_manifest").$type<Record<string, unknown>>().default({}).notNull(),
    previewAssets: jsonb("preview_assets").$type<Record<string, unknown>>().default({}).notNull(),
    accessibilityMetadata: jsonb("accessibility_metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    releaseNotes: varchar("release_notes", { length: 500 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.itemId, table.version], name: "point_catalog_item_versions_pk" }),
    check("point_catalog_item_versions_version_check", sql`${table.version} > 0`),
  ],
);

export const pointPurchases = pgTable(
  "point_purchases",
  {
    id: uuid("point_purchase_id").defaultRandom().primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => pointCatalogItems.id, { onDelete: "restrict" }),
    itemVersion: integer("item_version").notNull(),
    priceSnapshot: integer("price_snapshot").notNull(),
    spendLedgerEntryId: uuid("spend_ledger_entry_id")
      .notNull()
      .references(() => pointLedgerEntries.id, { onDelete: "restrict" }),
    refundLedgerEntryId: uuid("refund_ledger_entry_id").references(() => pointLedgerEntries.id, {
      onDelete: "restrict",
    }),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    status: varchar("status", { length: 16 }).default("COMPLETED").notNull(),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }).defaultNow().notNull(),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
  },
  (table) => [
    unique("point_purchases_idempotency_unique").on(table.idempotencyKey),
    unique("point_purchases_spend_ledger_unique").on(table.spendLedgerEntryId),
    uniqueIndex("point_purchases_refund_ledger_unique")
      .on(table.refundLedgerEntryId)
      .where(sql`${table.refundLedgerEntryId} is not null`),
    uniqueIndex("point_purchases_member_item_active_unique")
      .on(table.memberId, table.itemId)
      .where(sql`${table.status} = 'COMPLETED'`),
    check("point_purchases_price_check", sql`${table.priceSnapshot} > 0`),
    check("point_purchases_version_check", sql`${table.itemVersion} > 0`),
    check("point_purchases_status_check", sql`${table.status} in ('COMPLETED', 'REFUNDED')`),
    index("point_purchases_member_created_idx").on(table.memberId, table.purchasedAt),
  ],
);

export const memberInventory = pgTable(
  "member_inventory",
  {
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => pointCatalogItems.id, { onDelete: "restrict" }),
    purchaseId: uuid("purchase_id")
      .notNull()
      .references(() => pointPurchases.id, { onDelete: "restrict" }),
    acquiredFrom: varchar("acquired_from", { length: 24 }).default("PURCHASE").notNull(),
    state: varchar("state", { length: 16 }).default("OWNED").notNull(),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.memberId, table.itemId], name: "member_inventory_pk" }),
    unique("member_inventory_purchase_unique").on(table.purchaseId),
    check("member_inventory_state_check", sql`${table.state} in ('OWNED', 'EXPIRED', 'REVOKED')`),
    check(
      "member_inventory_acquired_from_check",
      sql`${table.acquiredFrom} in ('PURCHASE', 'GRANT', 'MIGRATION')`,
    ),
    index("member_inventory_member_state_idx").on(table.memberId, table.state),
  ],
);

export const memberEquipment = pgTable(
  "member_equipment",
  {
    memberId: uuid("member_id").notNull(),
    equipSlot: varchar("equip_slot", { length: 32 }).notNull(),
    itemId: uuid("item_id").notNull(),
    equippedAt: timestamp("equipped_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.memberId, table.equipSlot], name: "member_equipment_pk" }),
    foreignKey({
      columns: [table.memberId, table.itemId],
      foreignColumns: [memberInventory.memberId, memberInventory.itemId],
      name: "member_equipment_inventory_fk",
    }).onDelete("restrict"),
    index("member_equipment_item_idx").on(table.itemId),
  ],
);
