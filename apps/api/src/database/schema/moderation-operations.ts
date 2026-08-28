import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { moderationRecheckRequests } from "./content-revisions.js";
import { members } from "./identity.js";

export const moderationTargets = pgTable(
  "moderation_targets",
  {
    id: uuid("moderation_target_id").defaultRandom().primaryKey(),
    targetType: varchar("target_type", { length: 32 }).notNull(),
    targetId: uuid("target_id").notNull(),
    targetVersion: integer("target_version").notNull(),
    inputHash: varchar("input_hash", { length: 64 }).notNull(),
    snapshotReference: varchar("snapshot_reference", { length: 512 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("moderation_targets_natural_key_unique").on(
      table.targetType,
      table.targetId,
      table.targetVersion,
    ),
    index("moderation_targets_lookup_idx").on(
      table.targetType,
      table.targetId,
      table.targetVersion,
    ),
    check("moderation_targets_positive_version_check", sql`${table.targetVersion} > 0`),
    check(
      "moderation_targets_type_check",
      sql`${table.targetType} in ('COMMENT_VERSION', 'ISSUE_VERSION', 'ISSUE_MEDIA_ASSET', 'PROFILE_VERSION')`,
    ),
    check("moderation_targets_input_hash_check", sql`${table.inputHash} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const moderationRuns = pgTable(
  "moderation_runs",
  {
    id: uuid("moderation_run_id").defaultRandom().primaryKey(),
    targetId: uuid("moderation_target_id")
      .notNull()
      .references(() => moderationTargets.id, { onDelete: "restrict" }),
    recheckRequestId: uuid("recheck_request_id").references(() => moderationRecheckRequests.id, {
      onDelete: "set null",
    }),
    policyVersion: varchar("policy_version", { length: 64 }).notNull(),
    stage: varchar("stage", { length: 32 }).notNull(),
    normalizedInputHash: varchar("normalized_input_hash", { length: 64 }).notNull(),
    modelProvider: varchar("model_provider", { length: 48 }),
    modelName: varchar("model_name", { length: 96 }),
    modelVersion: varchar("model_version", { length: 64 }),
    ruleVersion: varchar("rule_version", { length: 64 }).notNull(),
    status: varchar("status", { length: 24 }).default("PENDING").notNull(),
    decisionSource: varchar("decision_source", { length: 24 }).notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().default({}).notNull(),
    latencyMs: integer("latency_ms"),
    costMicros: integer("cost_micros").default(0).notNull(),
    errorCode: varchar("error_code", { length: 96 }),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("moderation_runs_deduplication_unique").on(
      table.targetId,
      table.policyVersion,
      table.stage,
      table.normalizedInputHash,
    ),
    index("moderation_runs_status_created_idx").on(table.status, table.createdAt),
    check("moderation_runs_input_hash_check", sql`${table.normalizedInputHash} ~ '^[a-f0-9]{64}$'`),
    check(
      "moderation_runs_latency_check",
      sql`${table.latencyMs} is null or ${table.latencyMs} >= 0`,
    ),
    check("moderation_runs_cost_check", sql`${table.costMicros} >= 0`),
    check(
      "moderation_runs_status_check",
      sql`${table.status} in ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED')`,
    ),
    check(
      "moderation_runs_source_check",
      sql`${table.decisionSource} in ('RULE', 'MODEL', 'OPERATOR', 'SYSTEM')`,
    ),
  ],
);

export const moderationCases = pgTable(
  "moderation_cases",
  {
    id: uuid("moderation_case_id").defaultRandom().primaryKey(),
    targetId: uuid("moderation_target_id")
      .notNull()
      .references(() => moderationTargets.id, { onDelete: "restrict" }),
    latestRunId: uuid("latest_run_id").references(() => moderationRuns.id, {
      onDelete: "set null",
    }),
    status: varchar("status", { length: 24 }).default("OPEN").notNull(),
    riskLane: varchar("risk_lane", { length: 24 }).notNull(),
    priority: varchar("priority", { length: 8 }).notNull(),
    slaDueAt: timestamp("sla_due_at", { withTimezone: true }),
    assignedToMemberId: uuid("assigned_to_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    expectedRevision: integer("expected_revision").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("moderation_cases_queue_idx").on(table.status, table.priority, table.slaDueAt),
    index("moderation_cases_target_created_idx").on(table.targetId, table.createdAt),
    check("moderation_cases_revision_check", sql`${table.expectedRevision} > 0`),
    check(
      "moderation_cases_status_check",
      sql`${table.status} in ('OPEN', 'TRIAGED', 'IN_REVIEW', 'RESOLVED', 'CANCELLED')`,
    ),
    check(
      "moderation_cases_risk_lane_check",
      sql`${table.riskLane} in ('ALLOW', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'RIGHTS')`,
    ),
    check("moderation_cases_priority_check", sql`${table.priority} in ('P0', 'P1', 'P2', 'P3')`),
  ],
);

export const moderationCaseReferences = pgTable(
  "moderation_case_references",
  {
    id: uuid("moderation_case_reference_id").defaultRandom().primaryKey(),
    caseId: uuid("moderation_case_id")
      .notNull()
      .references(() => moderationCases.id, { onDelete: "cascade" }),
    referenceType: varchar("reference_type", { length: 32 }).notNull(),
    referenceId: uuid("reference_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("moderation_case_references_unique").on(
      table.caseId,
      table.referenceType,
      table.referenceId,
    ),
    check(
      "moderation_case_references_type_check",
      sql`${table.referenceType} in ('CONTENT_REPORT', 'COMMENT_REPORT', 'RIGHTS_REQUEST', 'APPEAL', 'RECONCILIATION')`,
    ),
  ],
);

export const moderationActions = pgTable(
  "moderation_actions",
  {
    id: uuid("moderation_action_id").defaultRandom().primaryKey(),
    caseId: uuid("moderation_case_id")
      .notNull()
      .references(() => moderationCases.id, { onDelete: "restrict" }),
    actionType: varchar("action_type", { length: 48 }).notNull(),
    domainDecisionType: varchar("domain_decision_type", { length: 48 }).notNull(),
    domainDecisionId: uuid("domain_decision_id").notNull(),
    actorType: varchar("actor_type", { length: 24 }).notNull(),
    actorMemberId: uuid("actor_member_id").references(() => members.id, { onDelete: "set null" }),
    beforeState: jsonb("before_state").$type<Record<string, unknown>>().notNull(),
    afterState: jsonb("after_state").$type<Record<string, unknown>>().notNull(),
    durationSeconds: integer("duration_seconds"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    reversalOfActionId: uuid("reversal_of_action_id"),
    noticeKey: varchar("notice_key", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("moderation_actions_domain_decision_unique").on(
      table.domainDecisionType,
      table.domainDecisionId,
    ),
    index("moderation_actions_case_created_idx").on(table.caseId, table.createdAt),
    check(
      "moderation_actions_decision_type_check",
      sql`${table.domainDecisionType} in ('COMMENT_MODERATION_DECISION', 'ISSUE_MEDIA_REVIEW_DECISION')`,
    ),
    check("moderation_actions_actor_check", sql`${table.actorType} in ('OPERATOR', 'SYSTEM')`),
    check(
      "moderation_actions_actor_member_check",
      sql`(${table.actorType} = 'OPERATOR' and ${table.actorMemberId} is not null) or ${table.actorType} = 'SYSTEM'`,
    ),
    check(
      "moderation_actions_duration_check",
      sql`${table.durationSeconds} is null or ${table.durationSeconds} > 0`,
    ),
  ],
);

export const moderationReconciliations = pgTable(
  "moderation_reconciliations",
  {
    id: uuid("moderation_reconciliation_id").defaultRandom().primaryKey(),
    caseId: uuid("moderation_case_id").references(() => moderationCases.id, {
      onDelete: "set null",
    }),
    targetId: uuid("moderation_target_id")
      .notNull()
      .references(() => moderationTargets.id, { onDelete: "restrict" }),
    resourceType: varchar("resource_type", { length: 24 }).notNull(),
    expectedReference: varchar("expected_reference", { length: 512 }).notNull(),
    observedReference: varchar("observed_reference", { length: 512 }),
    status: varchar("status", { length: 24 }).notNull(),
    repairReference: varchar("repair_reference", { length: 512 }),
    checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    index("moderation_reconciliations_status_checked_idx").on(table.status, table.checkedAt),
    check(
      "moderation_reconciliations_resource_check",
      sql`${table.resourceType} in ('DATABASE', 'R2', 'CDN')`,
    ),
    check(
      "moderation_reconciliations_status_check",
      sql`${table.status} in ('CONSISTENT', 'MISMATCH', 'REPAIRED', 'FAILED')`,
    ),
  ],
);

export const moderationAuditEvents = pgTable(
  "moderation_audit_events",
  {
    id: uuid("moderation_audit_event_id").defaultRandom().primaryKey(),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    entityType: varchar("entity_type", { length: 32 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    actorType: varchar("actor_type", { length: 24 }).notNull(),
    actorMemberId: uuid("actor_member_id").references(() => members.id, { onDelete: "set null" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("moderation_audit_events_entity_occurred_idx").on(
      table.entityType,
      table.entityId,
      table.occurredAt,
    ),
    check(
      "moderation_audit_events_entity_check",
      sql`${table.entityType} in ('TARGET', 'RUN', 'CASE', 'ACTION', 'RECONCILIATION')`,
    ),
    check("moderation_audit_events_actor_check", sql`${table.actorType} in ('OPERATOR', 'SYSTEM')`),
  ],
);
