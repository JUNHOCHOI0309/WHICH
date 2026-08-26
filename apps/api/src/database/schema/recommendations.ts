import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  boolean,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { issueVersions } from "./issues.js";
import { voterSubjects } from "./subjects.js";

export const issueInterestCards = pgTable(
  "issue_interest_cards",
  {
    issueId: uuid("issue_id").notNull(),
    issueVersion: integer("issue_version").notNull(),
    cardCode: varchar("card_code", { length: 32 }).notNull(),
    taxonomyVersion: varchar("taxonomy_version", { length: 32 }).notNull(),
    weight: integer("weight").default(100).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.issueId, table.issueVersion, table.cardCode],
      name: "issue_interest_cards_pk",
    }),
    foreignKey({
      columns: [table.issueId, table.issueVersion],
      foreignColumns: [issueVersions.issueId, issueVersions.version],
      name: "issue_interest_cards_issue_version_fk",
    }).onDelete("cascade"),
    index("issue_interest_cards_card_idx").on(table.cardCode, table.issueId),
    check("issue_interest_cards_weight_check", sql`${table.weight} between 1 and 1000`),
  ],
);

export const recommendationRequests = pgTable(
  "recommendation_requests",
  {
    id: uuid("recommendation_request_id").defaultRandom().primaryKey(),
    subjectId: uuid("subject_id").references(() => voterSubjects.id, { onDelete: "set null" }),
    rankingVersion: varchar("ranking_version", { length: 32 }).notNull(),
    rankingMode: varchar("ranking_mode", { length: 24 }).notNull(),
    reasonCode: varchar("reason_code", { length: 32 }).notNull(),
    profileVersion: integer("profile_version"),
    policyVersion: varchar("policy_version", { length: 32 })
      .default("interest-content-v2")
      .notNull(),
    qualityMode: varchar("quality_mode", { length: 16 }).default("OFF").notNull(),
    fallbackReason: varchar("fallback_reason", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("recommendation_requests_subject_created_idx").on(table.subjectId, table.createdAt),
    check(
      "recommendation_requests_mode_check",
      sql`${table.rankingMode} in ('PERSONALIZED', 'RECENCY')`,
    ),
    check(
      "recommendation_requests_profile_version_check",
      sql`${table.profileVersion} is null or ${table.profileVersion} > 0`,
    ),
    check(
      "recommendation_requests_quality_mode_check",
      sql`${table.qualityMode} in ('OFF', 'SHADOW', 'LIVE')`,
    ),
  ],
);

export const recommendationItems = pgTable(
  "recommendation_items",
  {
    requestId: uuid("recommendation_request_id")
      .notNull()
      .references(() => recommendationRequests.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    issueId: uuid("issue_id").notNull(),
    issueVersion: integer("issue_version").notNull(),
    score: integer("score").notNull(),
    reasonCodes: jsonb("reason_codes").$type<string[]>().notNull(),
    matchedCardCodes: jsonb("matched_card_codes").$type<string[]>().notNull(),
    candidateSources: jsonb("candidate_sources").$type<string[]>().default([]).notNull(),
    scoreComponents: jsonb("score_components")
      .$type<Record<string, number>>()
      .default({})
      .notNull(),
    qualityScore: integer("quality_score").default(0).notNull(),
    shadowPosition: integer("shadow_position"),
    controversyEligible: boolean("controversy_eligible").default(false).notNull(),
    qualityEligible: boolean("quality_eligible").default(true).notNull(),
    eligibilityReasons: jsonb("eligibility_reasons").$type<string[]>().default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.requestId, table.position],
      name: "recommendation_items_pk",
    }),
    unique("recommendation_items_request_issue_unique").on(table.requestId, table.issueId),
    foreignKey({
      columns: [table.issueId, table.issueVersion],
      foreignColumns: [issueVersions.issueId, issueVersions.version],
      name: "recommendation_items_issue_version_fk",
    }).onDelete("restrict"),
    check("recommendation_items_position_check", sql`${table.position} > 0`),
    check("recommendation_items_score_check", sql`${table.score} >= 0`),
    check("recommendation_items_quality_score_check", sql`${table.qualityScore} >= 0`),
    check(
      "recommendation_items_shadow_position_check",
      sql`${table.shadowPosition} is null or ${table.shadowPosition} > 0`,
    ),
  ],
);
