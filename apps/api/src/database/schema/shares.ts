import { sql } from "drizzle-orm";
import { check, foreignKey, integer, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { choiceCodeEnum } from "./enums.js";
import { issueChoices, issueVersions } from "./issues.js";
import { resultSnapshots } from "./results.js";

export const shareCards = pgTable(
  "share_cards",
  {
    id: uuid("share_card_id").defaultRandom().primaryKey(),
    version: varchar("share_version", { length: 32 }).default("result_share_v1").notNull(),
    issueId: uuid("issue_id").notNull(),
    issueVersion: integer("issue_version").notNull(),
    tallySnapshotId: uuid("tally_snapshot_id")
      .notNull()
      .references(() => resultSnapshots.id, { onDelete: "restrict" }),
    channel: varchar("share_channel", { length: 16 }).notNull(),
    sharedChoiceCode: choiceCodeEnum("shared_choice_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.issueId, table.issueVersion],
      foreignColumns: [issueVersions.issueId, issueVersions.version],
      name: "share_cards_issue_version_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.issueId, table.issueVersion, table.sharedChoiceCode],
      foreignColumns: [issueChoices.issueId, issueChoices.issueVersion, issueChoices.code],
      name: "share_cards_shared_choice_fk",
    }).onDelete("restrict"),
    check("share_cards_version_check", sql`${table.version} = 'result_share_v1'`),
    check("share_cards_channel_check", sql`${table.channel} in ('COPY', 'SYSTEM', 'X')`),
  ],
);
