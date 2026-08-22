import { sql } from "drizzle-orm";
import {
  index,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { members } from "./identity.js";
import { issues } from "./issues.js";
import { profileVisibilityEnum } from "./enums.js";

export const memberProfiles = pgTable(
  "member_profiles",
  {
    memberId: uuid("member_id")
      .primaryKey()
      .references(() => members.id, { onDelete: "cascade" }),
    handle: varchar("handle", { length: 30 }).notNull(),
    bio: varchar("bio", { length: 160 }),
    visibility: profileVisibilityEnum("visibility").default("PRIVATE").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("member_profiles_handle_lower_unique").on(sql`lower(${table.handle})`)],
);

export const issueAuthors = pgTable(
  "issue_authors",
  {
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.issueId], name: "issue_authors_pk" }),
    index("issue_authors_member_assigned_idx").on(table.memberId, table.assignedAt),
  ],
);
