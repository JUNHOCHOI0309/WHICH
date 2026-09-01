import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
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
import { issueChoices } from "./issues.js";

export const issueMediaLibraryPairs = pgTable(
  "issue_media_library_pairs",
  {
    id: uuid("library_pair_id").defaultRandom().primaryKey(),
    title: varchar("title", { length: 160 }).notNull(),
    categoryCode: varchar("category_code", { length: 64 }).notNull(),
    topics: text("topics")
      .array()
      .default(sql`ARRAY[]::text[]`)
      .notNull(),
    status: varchar("status", { length: 24 }).default("PUBLISHED").notNull(),
    createdByMemberId: uuid("created_by_member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    revokedByMemberId: uuid("revoked_by_member_id").references(() => members.id, {
      onDelete: "restrict",
    }),
    revokeReason: text("revoke_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("issue_media_library_pairs_discovery_idx").on(
      table.status,
      table.categoryCode,
      table.createdAt,
    ),
    check(
      "issue_media_library_pairs_status_check",
      sql`${table.status} in ('PUBLISHED', 'REVOKED')`,
    ),
    check(
      "issue_media_library_pairs_revoke_check",
      sql`(${table.status} = 'PUBLISHED' and ${table.revokedAt} is null and ${table.revokedByMemberId} is null)
        or (${table.status} = 'REVOKED' and ${table.revokedAt} is not null and ${table.revokedByMemberId} is not null and char_length(${table.revokeReason}) between 10 and 2000)`,
    ),
  ],
);

export const issueMediaLibraryAssets = pgTable(
  "issue_media_library_assets",
  {
    id: uuid("library_asset_id").defaultRandom().primaryKey(),
    pairId: uuid("library_pair_id")
      .notNull()
      .references(() => issueMediaLibraryPairs.id, { onDelete: "cascade" }),
    side: varchar("side", { length: 1 }).notNull(),
    mediaAssetId: uuid("media_asset_id")
      .notNull()
      .references(() => issueMediaAssets.id, { onDelete: "restrict" }),
    altText: varchar("alt_text", { length: 300 }).notNull(),
    cropMode: varchar("crop_mode", { length: 16 }).default("COVER").notNull(),
    sourceUrl: text("source_url").notNull(),
    authorName: varchar("author_name", { length: 200 }).notNull(),
    licenseName: varchar("license_name", { length: 160 }).notNull(),
    licenseVersion: varchar("license_version", { length: 80 }).notNull(),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull(),
    commercialAllowed: boolean("commercial_allowed").notNull(),
    derivativeAllowed: boolean("derivative_allowed").notNull(),
    redistributionAllowed: boolean("redistribution_allowed").notNull(),
    attributionText: text("attribution_text"),
    evidenceReference: text("evidence_reference").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("issue_media_library_assets_pair_side_unique").on(table.pairId, table.side),
    unique("issue_media_library_assets_media_unique").on(table.mediaAssetId),
    index("issue_media_library_assets_expiry_idx").on(table.expiresAt),
    check("issue_media_library_assets_side_check", sql`${table.side} in ('A', 'B')`),
    check(
      "issue_media_library_assets_alt_check",
      sql`char_length(${table.altText}) between 2 and 300`,
    ),
    check("issue_media_library_assets_crop_check", sql`${table.cropMode} in ('COVER', 'CONTAIN')`),
    check(
      "issue_media_library_assets_rights_check",
      sql`${table.commercialAllowed} and ${table.redistributionAllowed}
        and char_length(${table.sourceUrl}) between 8 and 2000
        and char_length(${table.evidenceReference}) between 8 and 2000`,
    ),
  ],
);

export const issueMediaLibraryUsages = pgTable(
  "issue_media_library_usages",
  {
    id: uuid("library_usage_id").defaultRandom().primaryKey(),
    pairId: uuid("library_pair_id")
      .notNull()
      .references(() => issueMediaLibraryPairs.id, { onDelete: "restrict" }),
    libraryAssetId: uuid("library_asset_id")
      .notNull()
      .references(() => issueMediaLibraryAssets.id, { onDelete: "restrict" }),
    issueId: uuid("issue_id").notNull(),
    issueVersion: integer("issue_version").notNull(),
    choiceId: uuid("choice_id").notNull(),
    side: varchar("side", { length: 1 }).notNull(),
    selectedByMemberId: uuid("selected_by_member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    status: varchar("status", { length: 24 }).default("ACTIVE").notNull(),
    fallbackReason: text("fallback_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.issueId, table.issueVersion, table.choiceId],
      foreignColumns: [issueChoices.issueId, issueChoices.issueVersion, issueChoices.id],
      name: "issue_media_library_usages_choice_fk",
    }).onDelete("cascade"),
    unique("issue_media_library_usages_choice_unique").on(
      table.issueId,
      table.issueVersion,
      table.choiceId,
    ),
    index("issue_media_library_usages_pair_status_idx").on(table.pairId, table.status),
    index("issue_media_library_usages_asset_status_idx").on(table.libraryAssetId, table.status),
    check("issue_media_library_usages_side_check", sql`${table.side} in ('A', 'B', 'C', 'D')`),
    check(
      "issue_media_library_usages_status_check",
      sql`${table.status} in ('ACTIVE', 'TEXT_FALLBACK', 'REPLACED')`,
    ),
    check(
      "issue_media_library_usages_fallback_check",
      sql`${table.status} = 'ACTIVE' or char_length(${table.fallbackReason}) between 10 and 2000`,
    ),
  ],
);
