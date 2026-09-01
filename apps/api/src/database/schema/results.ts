import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { resultIntegrityStateEnum } from "./enums.js";
import { issueVersions } from "./issues.js";

export const voteAggregates = pgTable(
  "vote_aggregates",
  {
    issueId: uuid("issue_id").notNull(),
    issueVersion: integer("issue_version").notNull(),
    resultVersion: integer("result_version").default(1).notNull(),
    voteRequestCount: integer("vote_request_count").default(0).notNull(),
    acceptedACount: integer("accepted_a_count").default(0).notNull(),
    acceptedBCount: integer("accepted_b_count").default(0).notNull(),
    acceptedCCount: integer("accepted_c_count").default(0).notNull(),
    acceptedDCount: integer("accepted_d_count").default(0).notNull(),
    acceptedVoteCount: integer("accepted_vote_count").default(0).notNull(),
    reviewVoteCount: integer("review_vote_count").default(0).notNull(),
    rejectedDuplicateCount: integer("rejected_duplicate_count").default(0).notNull(),
    rejectedAbuseCount: integer("rejected_abuse_count").default(0).notNull(),
    invalidatedVoteCount: integer("invalidated_vote_count").default(0).notNull(),
    displayedVoteCount: integer("displayed_vote_count").default(0).notNull(),
    integrityState: resultIntegrityStateEnum("integrity_state").default("NORMAL").notNull(),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.issueId, table.issueVersion], name: "vote_aggregates_pk" }),
    foreignKey({
      columns: [table.issueId, table.issueVersion],
      foreignColumns: [issueVersions.issueId, issueVersions.version],
      name: "vote_aggregates_issue_version_fk",
    }).onDelete("cascade"),
    check("vote_aggregates_result_version_check", sql`${table.resultVersion} > 0`),
    check(
      "vote_aggregates_counts_check",
      sql`${table.voteRequestCount} >= 0 and ${table.acceptedACount} >= 0 and ${table.acceptedBCount} >= 0
        and ${table.acceptedCCount} >= 0 and ${table.acceptedDCount} >= 0
        and ${table.reviewVoteCount} >= 0 and ${table.rejectedDuplicateCount} >= 0 and ${table.rejectedAbuseCount} >= 0
        and ${table.invalidatedVoteCount} >= 0 and ${table.acceptedVoteCount} = ${table.acceptedACount} + ${table.acceptedBCount} + ${table.acceptedCCount} + ${table.acceptedDCount}
        and ${table.displayedVoteCount} = ${table.acceptedVoteCount}`,
    ),
  ],
);

export const resultSnapshots = pgTable(
  "result_snapshots",
  {
    id: uuid("tally_snapshot_id").defaultRandom().primaryKey(),
    issueId: uuid("issue_id").notNull(),
    issueVersion: integer("issue_version").notNull(),
    resultVersion: integer("result_version").notNull(),
    acceptedACount: integer("accepted_a_count").notNull(),
    acceptedBCount: integer("accepted_b_count").notNull(),
    acceptedCCount: integer("accepted_c_count").default(0).notNull(),
    acceptedDCount: integer("accepted_d_count").default(0).notNull(),
    displayedVoteCount: integer("displayed_vote_count").notNull(),
    integrityState: resultIntegrityStateEnum("integrity_state").notNull(),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.issueId, table.issueVersion],
      foreignColumns: [issueVersions.issueId, issueVersions.version],
      name: "result_snapshots_issue_version_fk",
    }).onDelete("cascade"),
    unique("result_snapshots_issue_result_version_unique").on(
      table.issueId,
      table.issueVersion,
      table.resultVersion,
    ),
    check(
      "result_snapshots_counts_check",
      sql`${table.resultVersion} > 0 and ${table.acceptedACount} >= 0 and ${table.acceptedBCount} >= 0 and ${table.acceptedCCount} >= 0 and ${table.acceptedDCount} >= 0 and ${table.displayedVoteCount} = ${table.acceptedACount} + ${table.acceptedBCount} + ${table.acceptedCCount} + ${table.acceptedDCount}`,
    ),
  ],
);
