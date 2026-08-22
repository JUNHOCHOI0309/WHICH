import { sql } from "drizzle-orm";
import { check, integer, pgTable, primaryKey, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { voterSubjects } from "./subjects.js";

export const interestProfiles = pgTable(
  "interest_profiles",
  {
    subjectId: uuid("subject_id")
      .primaryKey()
      .references(() => voterSubjects.id, { onDelete: "cascade" }),
    onboardingState: varchar("onboarding_state", { length: 24 }).default("NOT_STARTED").notNull(),
    taxonomyVersion: varchar("taxonomy_version", { length: 32 }).notNull(),
    profileVersion: integer("profile_version").default(1).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    skippedAt: timestamp("skipped_at", { withTimezone: true }),
    resetAt: timestamp("reset_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "interest_profiles_onboarding_state_check",
      sql`${table.onboardingState} in ('NOT_STARTED', 'COMPLETED', 'SKIPPED', 'RESET')`,
    ),
    check("interest_profiles_positive_version_check", sql`${table.profileVersion} > 0`),
  ],
);

export const subjectInterests = pgTable(
  "subject_interests",
  {
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => interestProfiles.subjectId, { onDelete: "cascade" }),
    cardCode: varchar("card_code", { length: 32 }).notNull(),
    source: varchar("source", { length: 16 }).default("EXPLICIT").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.subjectId, table.cardCode], name: "subject_interests_pk" }),
    check("subject_interests_source_check", sql`${table.source} = 'EXPLICIT'`),
  ],
);
