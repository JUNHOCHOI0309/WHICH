import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { identityProviderEnum, memberStatusEnum } from "./enums.js";
import { voterSubjects } from "./subjects.js";

export const members = pgTable("members", {
  id: uuid("member_id").defaultRandom().primaryKey(),
  status: memberStatusEnum("status").default("ACTIVE").notNull(),
  displayName: varchar("display_name", { length: 80 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const memberIdentityLinks = pgTable(
  "member_identity_links",
  {
    id: uuid("identity_link_id").defaultRandom().primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    provider: identityProviderEnum("provider").notNull(),
    providerSubject: varchar("provider_subject", { length: 255 }).notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true }).defaultNow().notNull(),
    lastAuthenticatedAt: timestamp("last_authenticated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("member_identity_links_provider_subject_unique").on(
      table.provider,
      table.providerSubject,
    ),
    unique("member_identity_links_member_provider_unique").on(table.memberId, table.provider),
    index("member_identity_links_member_idx").on(table.memberId),
  ],
);

export const memberCredentials = pgTable(
  "member_credentials",
  {
    id: uuid("member_credential_id").defaultRandom().primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    emailNormalized: varchar("email_normalized", { length: 320 }).notNull(),
    passwordHash: varchar("password_hash", { length: 512 }).notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("member_credentials_member_unique").on(table.memberId),
    unique("member_credentials_email_unique").on(table.emailNormalized),
  ],
);

export const memberSessions = pgTable(
  "member_sessions",
  {
    id: uuid("member_session_id").defaultRandom().primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("member_sessions_token_hash_unique").on(table.tokenHash),
    index("member_sessions_member_created_idx").on(table.memberId, table.createdAt),
    index("member_sessions_active_expiry_idx")
      .on(table.expiresAt)
      .where(sql`${table.revokedAt} is null`),
    check("member_sessions_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const guestMemberLinks = pgTable(
  "guest_member_links",
  {
    id: uuid("guest_member_link_id").defaultRandom().primaryKey(),
    guestSubjectId: uuid("guest_subject_id")
      .notNull()
      .references(() => voterSubjects.id, { onDelete: "restrict" }),
    memberSubjectId: uuid("member_subject_id")
      .notNull()
      .references(() => voterSubjects.id, { onDelete: "restrict" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    provider: identityProviderEnum("provider").notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("guest_member_links_guest_unique").on(table.guestSubjectId),
    index("guest_member_links_member_idx").on(table.memberId, table.linkedAt),
    check(
      "guest_member_links_distinct_subjects_check",
      sql`${table.guestSubjectId} <> ${table.memberSubjectId}`,
    ),
  ],
);
