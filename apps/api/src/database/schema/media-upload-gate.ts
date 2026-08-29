import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { members } from "./identity.js";
import { issueMediaAssets } from "./issue-media.js";
import { memberIssueSubmissions } from "./issue-submissions.js";

export const memberCapabilityGrants = pgTable(
  "member_capability_grants",
  {
    id: uuid("grant_id").defaultRandom().primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    capabilityCode: varchar("capability_code", { length: 64 }).notNull(),
    state: varchar("state", { length: 24 }).default("ACTIVE").notNull(),
    policyVersion: varchar("policy_version", { length: 64 }).notNull(),
    grantedByMemberId: uuid("granted_by_member_id").references(() => members.id, {
      onDelete: "restrict",
    }),
    reason: text("reason").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("member_capability_grants_member_capability_unique").on(
      table.memberId,
      table.capabilityCode,
    ),
    index("member_capability_grants_state_expiry_idx").on(table.state, table.expiresAt),
    check(
      "member_capability_grants_code_check",
      sql`${table.capabilityCode} = 'ISSUE_IMAGE_UPLOAD'`,
    ),
    check(
      "member_capability_grants_state_check",
      sql`${table.state} in ('ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED')`,
    ),
    check("member_capability_grants_reason_check", sql`char_length(${table.reason}) >= 10`),
    check("member_capability_grants_expiry_check", sql`${table.expiresAt} > ${table.grantedAt}`),
  ],
);

export const memberCapabilityEvents = pgTable(
  "member_capability_events",
  {
    id: uuid("event_id").defaultRandom().primaryKey(),
    grantId: uuid("grant_id")
      .notNull()
      .references(() => memberCapabilityGrants.id, { onDelete: "restrict" }),
    action: varchar("action", { length: 24 }).notNull(),
    reasonCode: varchar("reason_code", { length: 64 }).notNull(),
    rationale: text("rationale").notNull(),
    actorMemberId: uuid("actor_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    requestId: varchar("request_id", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("member_capability_events_grant_created_idx").on(table.grantId, table.createdAt),
    check(
      "member_capability_events_action_check",
      sql`${table.action} in ('GRANTED', 'SUSPENDED', 'REVOKED', 'EXPIRED', 'APPEALED', 'RESTORED')`,
    ),
    check("member_capability_events_rationale_check", sql`char_length(${table.rationale}) >= 10`),
  ],
);

export const memberMediaConsents = pgTable(
  "member_media_consents",
  {
    id: uuid("consent_id").defaultRandom().primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    consentVersion: varchar("consent_version", { length: 64 }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    unique("member_media_consents_member_version_unique").on(table.memberId, table.consentVersion),
    index("member_media_consents_member_accepted_idx").on(table.memberId, table.acceptedAt),
    check(
      "member_media_consents_revocation_check",
      sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.acceptedAt}`,
    ),
  ],
);

export const issueMediaUploadSessions = pgTable(
  "issue_media_upload_sessions",
  {
    id: uuid("upload_session_id").defaultRandom().primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => memberIssueSubmissions.id, { onDelete: "cascade" }),
    objectKey: varchar("object_key", { length: 512 }).notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    memberPseudonym: varchar("member_pseudonym", { length: 64 }).notNull(),
    ipPseudonym: varchar("ip_pseudonym", { length: 64 }).notNull(),
    state: varchar("state", { length: 24 }).default("CREATED").notNull(),
    maxBytes: integer("max_bytes").notNull(),
    consumedBytes: integer("consumed_bytes"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("issue_media_upload_sessions_object_key_unique").on(table.objectKey),
    unique("issue_media_upload_sessions_token_hash_unique").on(table.tokenHash),
    index("issue_media_upload_sessions_member_created_idx").on(table.memberId, table.createdAt),
    index("issue_media_upload_sessions_ip_created_idx").on(table.ipPseudonym, table.createdAt),
    index("issue_media_upload_sessions_state_expiry_idx").on(table.state, table.expiresAt),
    check(
      "issue_media_upload_sessions_state_check",
      sql`${table.state} in ('CREATED', 'CONSUMED', 'EXPIRED', 'REJECTED')`,
    ),
    check(
      "issue_media_upload_sessions_byte_check",
      sql`${table.maxBytes} between 1 and 10485760 and (${table.consumedBytes} is null or ${table.consumedBytes} between 1 and ${table.maxBytes})`,
    ),
    check("issue_media_upload_sessions_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "issue_media_upload_sessions_consumed_check",
      sql`(${table.state} = 'CONSUMED' and ${table.consumedAt} is not null and ${table.consumedBytes} is not null) or (${table.state} <> 'CONSUMED')`,
    ),
  ],
);

export const issueMediaKnownBlockHashes = pgTable(
  "issue_media_known_block_hashes",
  {
    sha256: varchar("sha256", { length: 64 }).primaryKey(),
    policyVersion: varchar("policy_version", { length: 64 }).notNull(),
    reasonCode: varchar("reason_code", { length: 64 }).notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
  },
  (table) => [
    index("issue_media_known_block_hashes_active_idx").on(table.active, table.createdAt),
    check("issue_media_known_block_hashes_sha_check", sql`${table.sha256} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const issueMediaRuleFindings = pgTable(
  "issue_media_rule_findings",
  {
    id: uuid("finding_id").defaultRandom().primaryKey(),
    uploadSessionId: uuid("upload_session_id").references(() => issueMediaUploadSessions.id, {
      onDelete: "cascade",
    }),
    mediaAssetId: uuid("media_asset_id").references(() => issueMediaAssets.id, {
      onDelete: "cascade",
    }),
    stage: varchar("stage", { length: 32 }).notNull(),
    code: varchar("code", { length: 64 }).notNull(),
    severity: varchar("severity", { length: 16 }).notNull(),
    sourceVersion: varchar("source_version", { length: 64 }).notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("issue_media_rule_findings_session_created_idx").on(
      table.uploadSessionId,
      table.createdAt,
    ),
    index("issue_media_rule_findings_asset_created_idx").on(table.mediaAssetId, table.createdAt),
    check(
      "issue_media_rule_findings_target_check",
      sql`${table.uploadSessionId} is not null or ${table.mediaAssetId} is not null`,
    ),
    check(
      "issue_media_rule_findings_severity_check",
      sql`${table.severity} in ('INFO', 'REVIEW', 'BLOCK')`,
    ),
  ],
);
