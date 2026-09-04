import { sql } from "drizzle-orm";
import { boolean, index, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";

import { issues } from "./issues.js";
import { members } from "./identity.js";

export const issueRecommendations = pgTable(
  "issue_recommendations",
  {
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "restrict" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.issueId, table.memberId],
      name: "issue_recommendations_pk",
    }),
    index("issue_recommendations_active_issue_idx")
      .on(table.issueId)
      .where(sql`${table.active} = true`),
  ],
);
