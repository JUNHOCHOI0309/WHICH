import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { subjectKindEnum } from "./enums.js";

export const voterSubjects = pgTable(
  "voter_subjects",
  {
    id: uuid("subject_id").defaultRandom().primaryKey(),
    kind: subjectKindEnum("subject_kind").notNull(),
    anonymousSubjectId: uuid("anonymous_subject_id"),
    userId: uuid("user_id"),
    verifiedUniquenessHandle: text("verified_uniqueness_handle"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("voter_subjects_anonymous_unique")
      .on(table.anonymousSubjectId)
      .where(sql`${table.anonymousSubjectId} is not null`),
    uniqueIndex("voter_subjects_user_unique")
      .on(table.userId)
      .where(sql`${table.userId} is not null`),
    uniqueIndex("voter_subjects_verified_handle_unique")
      .on(table.verifiedUniquenessHandle)
      .where(sql`${table.verifiedUniquenessHandle} is not null`),
    check(
      "voter_subjects_identity_shape_check",
      sql`(${table.kind} = 'GUEST' and ${table.anonymousSubjectId} is not null and ${table.userId} is null and ${table.verifiedUniquenessHandle} is null)
        or (${table.kind} = 'MEMBER' and ${table.anonymousSubjectId} is null and ${table.userId} is not null and ${table.verifiedUniquenessHandle} is null)
        or (${table.kind} = 'VERIFIED_MEMBER' and ${table.anonymousSubjectId} is null and ${table.userId} is not null and ${table.verifiedUniquenessHandle} is not null)`,
    ),
  ],
);
