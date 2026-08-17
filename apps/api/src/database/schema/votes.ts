import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import {
  riskLevelEnum,
  voteActionEnum,
  voteIntegrityStateEnum,
  voteRequestStateEnum,
} from "./enums.js";
import { issueChoices, issueVersions } from "./issues.js";
import { voterSubjects } from "./subjects.js";

export const voteAttempts = pgTable(
  "vote_attempts",
  {
    id: uuid("vote_attempt_id").primaryKey(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    issueId: uuid("issue_id").notNull(),
    issueVersion: integer("issue_version").notNull(),
    choiceId: uuid("choice_id").notNull(),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => voterSubjects.id, { onDelete: "restrict" }),
    requestState: voteRequestStateEnum("request_state").default("RECEIVED").notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    responseSnapshot: jsonb("response_snapshot").$type<Record<string, unknown>>(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    unique("vote_attempts_idempotency_key_unique").on(table.idempotencyKey),
    foreignKey({
      columns: [table.issueId, table.issueVersion],
      foreignColumns: [issueVersions.issueId, issueVersions.version],
      name: "vote_attempts_issue_version_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.issueId, table.issueVersion, table.choiceId],
      foreignColumns: [issueChoices.issueId, issueChoices.issueVersion, issueChoices.id],
      name: "vote_attempts_choice_fk",
    }).onDelete("restrict"),
    index("vote_attempts_subject_received_idx").on(table.subjectId, table.receivedAt),
  ],
);

export const votes = pgTable(
  "votes",
  {
    id: uuid("vote_id").defaultRandom().primaryKey(),
    voteAttemptId: uuid("vote_attempt_id")
      .notNull()
      .references(() => voteAttempts.id, { onDelete: "restrict" }),
    issueId: uuid("issue_id").notNull(),
    issueVersion: integer("issue_version").notNull(),
    choiceId: uuid("choice_id").notNull(),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => voterSubjects.id, { onDelete: "restrict" }),
    integrityState: voteIntegrityStateEnum("integrity_state").notNull(),
    reasonCode: varchar("reason_code", { length: 64 }),
    userTier: varchar("user_tier", { length: 32 }).notNull(),
    accountAssurance: varchar("account_assurance", { length: 32 }).notNull(),
    uniquenessAssurance: varchar("uniqueness_assurance", { length: 32 }).notNull(),
    issueRiskLevel: riskLevelEnum("issue_risk_level").notNull(),
    eligibilityPolicyVersion: varchar("eligibility_policy_version", { length: 32 }).notNull(),
    integrityPolicyVersion: varchar("integrity_policy_version", { length: 32 }).notNull(),
    verificationScope: varchar("verification_scope", { length: 64 }),
    isTestSubject: boolean("is_test_subject").default(false).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("votes_vote_attempt_unique").on(table.voteAttemptId),
    foreignKey({
      columns: [table.issueId, table.issueVersion],
      foreignColumns: [issueVersions.issueId, issueVersions.version],
      name: "votes_issue_version_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.issueId, table.issueVersion, table.choiceId],
      foreignColumns: [issueChoices.issueId, issueChoices.issueVersion, issueChoices.id],
      name: "votes_choice_fk",
    }).onDelete("restrict"),
    uniqueIndex("votes_one_accepted_per_issue_subject_unique")
      .on(table.issueId, table.subjectId)
      .where(sql`${table.integrityState} = 'ACCEPTED'`),
    index("votes_issue_version_integrity_idx").on(
      table.issueId,
      table.issueVersion,
      table.integrityState,
    ),
    check(
      "votes_integrity_timestamps_check",
      sql`(${table.integrityState} = 'ACCEPTED' and ${table.acceptedAt} is not null and ${table.invalidatedAt} is null)
        or (${table.integrityState} = 'INVALIDATED' and ${table.acceptedAt} is not null and ${table.invalidatedAt} is not null)
        or ${table.integrityState} in ('REVIEW', 'REJECTED_DUPLICATE', 'REJECTED_ABUSE')`,
    ),
  ],
);

export const voteIntegrityDecisions = pgTable(
  "vote_integrity_decisions",
  {
    id: uuid("vote_integrity_decision_id").defaultRandom().primaryKey(),
    voteId: uuid("vote_id")
      .notNull()
      .references(() => votes.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    fromState: voteIntegrityStateEnum("from_state"),
    toState: voteIntegrityStateEnum("to_state").notNull(),
    action: voteActionEnum("action"),
    reasonCode: varchar("reason_code", { length: 64 }).notNull(),
    policyVersion: varchar("policy_version", { length: 32 }).notNull(),
    actorType: varchar("actor_type", { length: 32 }).notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("vote_integrity_decisions_vote_revision_unique").on(table.voteId, table.revision),
    check("vote_integrity_decisions_positive_revision_check", sql`${table.revision} > 0`),
    index("vote_integrity_decisions_vote_decided_idx").on(table.voteId, table.decidedAt),
  ],
);
