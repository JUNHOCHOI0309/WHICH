import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { members } from "./identity.js";
import { issueChoices, issues, issueVersions } from "./issues.js";

export const issueMediaAssets = pgTable(
  "issue_media_assets",
  {
    id: uuid("media_asset_id").defaultRandom().primaryKey(),
    uploadedByMemberId: uuid("uploaded_by_member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    sourceType: varchar("source_type", { length: 32 }).notNull(),
    rightsAttestation: text("rights_attestation").notNull(),
    rightsAttestedAt: timestamp("rights_attested_at", { withTimezone: true }).notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    perceptualHash: varchar("perceptual_hash", { length: 16 }).notNull(),
    inputMimeType: varchar("input_mime_type", { length: 32 }).notNull(),
    inputByteSize: integer("input_byte_size").notNull(),
    inputWidth: integer("input_width").notNull(),
    inputHeight: integer("input_height").notNull(),
    outputMimeType: varchar("output_mime_type", { length: 32 }).default("image/webp").notNull(),
    outputByteSize: integer("output_byte_size").notNull(),
    outputWidth: integer("output_width").notNull(),
    outputHeight: integer("output_height").notNull(),
    processingState: varchar("processing_state", { length: 24 }).default("READY").notNull(),
    moderationState: varchar("moderation_state", { length: 24 }).default("PENDING").notNull(),
    storageState: varchar("storage_state", { length: 24 }).default("STAGED").notNull(),
    rightsState: varchar("rights_state", { length: 24 }).default("ASSERTED").notNull(),
    stagingObjectKey: varchar("staging_object_key", { length: 512 }),
    publishedObjectKey: varchar("published_object_key", { length: 512 }),
    quarantinedObjectKey: varchar("quarantined_object_key", { length: 512 }),
    stagedAt: timestamp("staged_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    quarantinedAt: timestamp("quarantined_at", { withTimezone: true }),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("issue_media_assets_sha256_unique").on(table.sha256),
    index("issue_media_assets_lifecycle_idx").on(
      table.storageState,
      table.moderationState,
      table.updatedAt,
    ),
    index("issue_media_assets_perceptual_hash_idx").on(table.perceptualHash),
    check(
      "issue_media_assets_source_type_check",
      sql`${table.sourceType} in ('OPERATOR_UPLOAD', 'MEMBER_SUBMISSION')`,
    ),
    check(
      "issue_media_assets_processing_state_check",
      sql`${table.processingState} in ('PENDING', 'PROCESSING', 'READY', 'FAILED')`,
    ),
    check(
      "issue_media_assets_moderation_state_check",
      sql`${table.moderationState} in ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED')`,
    ),
    check(
      "issue_media_assets_storage_state_check",
      sql`${table.storageState} in ('STAGED', 'PUBLISHED', 'QUARANTINED', 'PURGED')`,
    ),
    check(
      "issue_media_assets_rights_state_check",
      sql`${table.rightsState} in ('ASSERTED', 'CHALLENGED', 'CLEARED', 'WITHDRAWN')`,
    ),
    check(
      "issue_media_assets_mime_check",
      sql`${table.inputMimeType} in ('image/jpeg', 'image/png', 'image/webp') and ${table.outputMimeType} = 'image/webp'`,
    ),
    check(
      "issue_media_assets_dimensions_check",
      sql`${table.inputByteSize} > 0 and ${table.outputByteSize} > 0 and ${table.inputWidth} > 0 and ${table.inputHeight} > 0 and ${table.outputWidth} > 0 and ${table.outputHeight} > 0`,
    ),
    check(
      "issue_media_assets_attestation_check",
      sql`char_length(${table.rightsAttestation}) between 20 and 2000`,
    ),
    check(
      "issue_media_assets_storage_keys_check",
      sql`(${table.storageState} <> 'STAGED' or ${table.stagingObjectKey} is not null)
        and (${table.storageState} <> 'PUBLISHED' or ${table.publishedObjectKey} is not null)
        and (${table.storageState} <> 'QUARANTINED' or ${table.quarantinedObjectKey} is not null)
        and (${table.storageState} <> 'PURGED' or ${table.purgedAt} is not null)`,
    ),
  ],
);

export const issueChoiceMedia = pgTable(
  "issue_choice_media",
  {
    issueId: uuid("issue_id").notNull(),
    issueVersion: integer("issue_version").notNull(),
    choiceId: uuid("choice_id").notNull(),
    mediaAssetId: uuid("media_asset_id")
      .notNull()
      .references(() => issueMediaAssets.id, { onDelete: "restrict" }),
    altText: varchar("alt_text", { length: 300 }).notNull(),
    cropMode: varchar("crop_mode", { length: 16 }).default("COVER").notNull(),
    displayPosition: integer("display_position").notNull(),
    linkedByMemberId: uuid("linked_by_member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.issueId, table.issueVersion, table.choiceId],
      name: "issue_choice_media_pk",
    }),
    foreignKey({
      columns: [table.issueId, table.issueVersion, table.choiceId],
      foreignColumns: [issueChoices.issueId, issueChoices.issueVersion, issueChoices.id],
      name: "issue_choice_media_choice_fk",
    }).onDelete("cascade"),
    unique("issue_choice_media_position_unique").on(
      table.issueId,
      table.issueVersion,
      table.displayPosition,
    ),
    check(
      "issue_choice_media_alt_text_check",
      sql`char_length(${table.altText}) between 2 and 300`,
    ),
    check("issue_choice_media_crop_mode_check", sql`${table.cropMode} in ('COVER', 'CONTAIN')`),
    check("issue_choice_media_position_check", sql`${table.displayPosition} between 0 and 3`),
  ],
);

export const issueContextMedia = pgTable(
  "issue_context_media",
  {
    issueId: uuid("issue_id").notNull(),
    issueVersion: integer("issue_version").notNull(),
    mediaAssetId: uuid("media_asset_id")
      .notNull()
      .references(() => issueMediaAssets.id, { onDelete: "restrict" }),
    altText: varchar("alt_text", { length: 300 }).notNull(),
    cropMode: varchar("crop_mode", { length: 16 }).default("CONTAIN").notNull(),
    linkedByMemberId: uuid("linked_by_member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.issueId, table.issueVersion], name: "issue_context_media_pk" }),
    foreignKey({
      columns: [table.issueId, table.issueVersion],
      foreignColumns: [issueVersions.issueId, issueVersions.version],
      name: "issue_context_media_issue_version_fk",
    }).onDelete("cascade"),
    check(
      "issue_context_media_alt_text_check",
      sql`char_length(${table.altText}) between 2 and 300`,
    ),
    check("issue_context_media_crop_mode_check", sql`${table.cropMode} in ('COVER', 'CONTAIN')`),
  ],
);

export const issueMediaReviewDecisions = pgTable(
  "issue_media_review_decisions",
  {
    id: uuid("issue_media_review_decision_id").defaultRandom().primaryKey(),
    scope: varchar("scope", { length: 16 }).notNull(),
    mediaAssetId: uuid("media_asset_id").references(() => issueMediaAssets.id, {
      onDelete: "restrict",
    }),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "restrict" }),
    status: varchar("status", { length: 24 }).notNull(),
    reasonCode: varchar("reason_code", { length: 64 }).notNull(),
    rationale: text("rationale").notNull(),
    policyVersion: varchar("policy_version", { length: 64 }).notNull(),
    reviewedByMemberId: uuid("reviewed_by_member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    requestId: varchar("request_id", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("issue_media_review_asset_created_idx").on(table.mediaAssetId, table.createdAt),
    index("issue_media_review_issue_created_idx").on(table.issueId, table.createdAt),
    check("issue_media_review_scope_check", sql`${table.scope} in ('ASSET', 'ISSUE')`),
    check(
      "issue_media_review_target_check",
      sql`(${table.scope} = 'ASSET' and ${table.mediaAssetId} is not null and ${table.issueId} is null)
        or (${table.scope} = 'ISSUE' and ${table.issueId} is not null and ${table.mediaAssetId} is null)`,
    ),
    check(
      "issue_media_review_status_check",
      sql`${table.status} in ('APPROVED', 'REJECTED', 'HIDDEN', 'RESTORED', 'DELETED')`,
    ),
    check(
      "issue_media_review_rationale_check",
      sql`char_length(${table.rationale}) between 10 and 2000`,
    ),
  ],
);

export const issueMediaRightsRequests = pgTable(
  "issue_media_rights_requests",
  {
    id: uuid("issue_media_rights_request_id").defaultRandom().primaryKey(),
    requestType: varchar("request_type", { length: 24 }).notNull(),
    mediaAssetId: uuid("media_asset_id").references(() => issueMediaAssets.id, {
      onDelete: "restrict",
    }),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "restrict" }),
    requesterReference: varchar("requester_reference", { length: 300 }).notNull(),
    details: text("details").notNull(),
    status: varchar("status", { length: 24 }).default("OPEN").notNull(),
    resolution: text("resolution"),
    actionDecisionId: uuid("action_decision_id").references(() => issueMediaReviewDecisions.id, {
      onDelete: "restrict",
    }),
    recordedByMemberId: uuid("recorded_by_member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    resolvedByMemberId: uuid("resolved_by_member_id").references(() => members.id, {
      onDelete: "restrict",
    }),
    requestId: varchar("request_id", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("issue_media_rights_status_created_idx").on(table.status, table.createdAt),
    index("issue_media_rights_asset_idx").on(table.mediaAssetId, table.createdAt),
    index("issue_media_rights_issue_idx").on(table.issueId, table.createdAt),
    check(
      "issue_media_rights_type_check",
      sql`${table.requestType} in ('PRIVACY', 'DEFAMATION', 'COPYRIGHT')`,
    ),
    check(
      "issue_media_rights_target_check",
      sql`${table.mediaAssetId} is not null or ${table.issueId} is not null`,
    ),
    check(
      "issue_media_rights_status_check",
      sql`${table.status} in ('OPEN', 'ACTIONED', 'DISMISSED')`,
    ),
    check(
      "issue_media_rights_details_check",
      sql`char_length(${table.details}) between 10 and 4000`,
    ),
    check(
      "issue_media_rights_resolution_check",
      sql`(${table.status} = 'OPEN' and ${table.resolvedAt} is null and ${table.resolvedByMemberId} is null)
        or (${table.status} <> 'OPEN' and ${table.resolvedAt} is not null and ${table.resolvedByMemberId} is not null and char_length(${table.resolution}) between 10 and 4000)`,
    ),
  ],
);
