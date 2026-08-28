import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { comments } from "./comments.js";
import { issueMediaAssets } from "./issue-media.js";
import { issueVersions } from "./issues.js";

export type IssueChoiceSnapshot = {
  id: string;
  code: string;
  label: string;
};

export type IssueMediaSnapshot = {
  choiceId: string;
  choiceCode: string;
  assetId: string;
  assetVersion: number;
  sha256: string;
  altText: string;
  cropMode: string;
  displayPosition: number;
  rightsAttestation: string;
};

export const commentRevisions = pgTable(
  "comment_revisions",
  {
    id: uuid("comment_revision_id").defaultRandom().primaryKey(),
    commentId: uuid("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    operation: varchar("operation", { length: 32 }).notNull(),
    body: text("body").notNull(),
    textPolicyVersion: varchar("text_policy_version", { length: 32 }).notNull(),
    inputHash: varchar("input_hash", { length: 64 }).notNull(),
    hashAlgorithm: varchar("hash_algorithm", { length: 24 }).default("SHA256").notNull(),
    sourceCommentVersion: integer("source_comment_version").notNull(),
    publicationState: varchar("publication_state", { length: 32 }).notNull(),
    visibility: varchar("visibility", { length: 32 }).notNull(),
    integrityState: varchar("integrity_state", { length: 32 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("comment_revisions_comment_revision_unique").on(table.commentId, table.revision),
    index("comment_revisions_comment_created_idx").on(table.commentId, table.createdAt),
    check("comment_revisions_positive_revision_check", sql`${table.revision} > 0`),
    check(
      "comment_revisions_operation_check",
      sql`${table.operation} in ('CREATED', 'EDITED', 'AUTHOR_REMOVED', 'LEGACY_BACKFILL')`,
    ),
    check(
      "comment_revisions_hash_algorithm_check",
      sql`${table.hashAlgorithm} in ('SHA256', 'LEGACY_MD5_PAIR')`,
    ),
  ],
);

export const issueMediaAssetVersions = pgTable(
  "issue_media_asset_versions",
  {
    assetId: uuid("media_asset_id")
      .notNull()
      .references(() => issueMediaAssets.id, { onDelete: "restrict" }),
    version: integer("asset_version").notNull(),
    sourceType: varchar("source_type", { length: 32 }).notNull(),
    rightsAttestation: text("rights_attestation").notNull(),
    rightsAttestedAt: timestamp("rights_attested_at", { withTimezone: true }).notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    perceptualHash: varchar("perceptual_hash", { length: 16 }).notNull(),
    inputMimeType: varchar("input_mime_type", { length: 32 }).notNull(),
    inputByteSize: integer("input_byte_size").notNull(),
    inputWidth: integer("input_width").notNull(),
    inputHeight: integer("input_height").notNull(),
    outputMimeType: varchar("output_mime_type", { length: 32 }).notNull(),
    outputByteSize: integer("output_byte_size").notNull(),
    outputWidth: integer("output_width").notNull(),
    outputHeight: integer("output_height").notNull(),
    normalizedObjectRef: varchar("normalized_object_ref", { length: 512 }).notNull(),
    inputHash: varchar("input_hash", { length: 64 }).notNull(),
    hashAlgorithm: varchar("hash_algorithm", { length: 24 }).default("SHA256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.assetId, table.version], name: "issue_media_asset_versions_pk" }),
    unique("issue_media_asset_versions_sha256_unique").on(table.sha256),
    check("issue_media_asset_versions_positive_version_check", sql`${table.version} > 0`),
  ],
);

export const issueChoiceMediaRevisions = pgTable(
  "issue_choice_media_revisions",
  {
    issueId: uuid("issue_id").notNull(),
    issueVersion: integer("issue_version").notNull(),
    choiceId: uuid("choice_id").notNull(),
    revision: integer("revision").notNull(),
    operation: varchar("operation", { length: 24 }).notNull(),
    mediaAssetId: uuid("media_asset_id").references(() => issueMediaAssets.id, {
      onDelete: "restrict",
    }),
    mediaAssetVersion: integer("media_asset_version"),
    mediaSha256: varchar("media_sha256", { length: 64 }),
    altText: varchar("alt_text", { length: 300 }),
    cropMode: varchar("crop_mode", { length: 16 }),
    displayPosition: integer("display_position"),
    rightsAttestation: text("rights_attestation"),
    linkedByMemberId: uuid("linked_by_member_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.issueId, table.issueVersion, table.choiceId, table.revision],
      name: "issue_choice_media_revisions_pk",
    }),
    foreignKey({
      columns: [table.issueId, table.issueVersion],
      foreignColumns: [issueVersions.issueId, issueVersions.version],
      name: "issue_choice_media_revisions_issue_version_fk",
    }).onDelete("restrict"),
    index("issue_choice_media_revisions_asset_idx").on(table.mediaAssetId, table.createdAt),
    check("issue_choice_media_revisions_positive_revision_check", sql`${table.revision} > 0`),
    check(
      "issue_choice_media_revisions_operation_check",
      sql`${table.operation} in ('ATTACHED', 'REPLACED', 'DETACHED', 'LEGACY_BACKFILL')`,
    ),
    check(
      "issue_choice_media_revisions_shape_check",
      sql`(${table.operation} = 'DETACHED' and ${table.mediaAssetId} is null)
        or (${table.operation} <> 'DETACHED' and ${table.mediaAssetId} is not null and ${table.mediaAssetVersion} is not null and ${table.mediaSha256} is not null)`,
    ),
  ],
);

export const issueVersionSnapshots = pgTable(
  "issue_version_snapshots",
  {
    issueId: uuid("issue_id").notNull(),
    issueVersion: integer("issue_version").notNull(),
    question: text("question").notNull(),
    context: text("context"),
    choicesSnapshot: jsonb("choices_snapshot").$type<IssueChoiceSnapshot[]>().notNull(),
    mediaSnapshot: jsonb("media_snapshot").$type<IssueMediaSnapshot[]>().notNull(),
    sourceContentHash: varchar("source_content_hash", { length: 64 }).notNull(),
    inputHash: varchar("input_hash", { length: 64 }).notNull(),
    policyVersion: varchar("policy_version", { length: 64 }).notNull(),
    sealedAt: timestamp("sealed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.issueId, table.issueVersion],
      name: "issue_version_snapshots_pk",
    }),
    foreignKey({
      columns: [table.issueId, table.issueVersion],
      foreignColumns: [issueVersions.issueId, issueVersions.version],
      name: "issue_version_snapshots_issue_version_fk",
    }).onDelete("restrict"),
  ],
);

export const moderationRecheckRequests = pgTable(
  "moderation_recheck_requests",
  {
    id: uuid("moderation_recheck_request_id").defaultRandom().primaryKey(),
    targetType: varchar("target_type", { length: 32 }).notNull(),
    targetId: uuid("target_id").notNull(),
    targetVersion: integer("target_version").notNull(),
    policyVersion: varchar("policy_version", { length: 64 }).notNull(),
    inputHash: varchar("input_hash", { length: 64 }).notNull(),
    normalizedSnapshotRef: varchar("normalized_snapshot_ref", { length: 512 }).notNull(),
    ocrTranscriptRef: varchar("ocr_transcript_ref", { length: 512 }),
    reason: varchar("reason", { length: 24 }).notNull(),
    status: varchar("status", { length: 24 }).default("PENDING").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
  },
  (table) => [
    unique("moderation_recheck_requests_natural_key_unique").on(
      table.targetType,
      table.targetId,
      table.targetVersion,
      table.policyVersion,
      table.inputHash,
    ),
    index("moderation_recheck_requests_status_requested_idx").on(table.status, table.requestedAt),
    check("moderation_recheck_requests_positive_version_check", sql`${table.targetVersion} > 0`),
    check(
      "moderation_recheck_requests_target_type_check",
      sql`${table.targetType} in ('COMMENT_REVISION', 'ISSUE_VERSION', 'MEDIA_ASSET_VERSION')`,
    ),
    check(
      "moderation_recheck_requests_reason_check",
      sql`${table.reason} in ('CREATE', 'EDIT', 'REPLACEMENT', 'POLICY_CHANGE', 'APPEAL', 'RIGHTS', 'BACKFILL')`,
    ),
    check(
      "moderation_recheck_requests_status_check",
      sql`${table.status} in ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')`,
    ),
  ],
);

export const contentRetentionDirectives = pgTable(
  "content_retention_directives",
  {
    id: uuid("content_retention_directive_id").defaultRandom().primaryKey(),
    targetType: varchar("target_type", { length: 32 }).notNull(),
    targetId: uuid("target_id").notNull(),
    targetVersion: integer("target_version"),
    directiveType: varchar("directive_type", { length: 32 }).notNull(),
    precedence: integer("precedence").notNull(),
    reason: text("reason").notNull(),
    reference: varchar("reference", { length: 300 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (table) => [
    index("content_retention_directives_target_idx").on(
      table.targetType,
      table.targetId,
      table.targetVersion,
      table.createdAt,
    ),
    check(
      "content_retention_directives_type_check",
      sql`${table.directiveType} in ('CONTENT_DELETION', 'MEMBER_DELETION', 'APPEAL', 'RIGHTS', 'LEGAL_HOLD')`,
    ),
    check(
      "content_retention_directives_precedence_check",
      sql`(${table.directiveType} = 'CONTENT_DELETION' and ${table.precedence} = 100)
        or (${table.directiveType} = 'MEMBER_DELETION' and ${table.precedence} = 200)
        or (${table.directiveType} = 'APPEAL' and ${table.precedence} = 300)
        or (${table.directiveType} = 'RIGHTS' and ${table.precedence} = 400)
        or (${table.directiveType} = 'LEGAL_HOLD' and ${table.precedence} = 500)`,
    ),
  ],
);
