CREATE TABLE "comment_revisions" (
	"comment_revision_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"operation" varchar(32) NOT NULL,
	"body" text NOT NULL,
	"text_policy_version" varchar(32) NOT NULL,
	"input_hash" varchar(64) NOT NULL,
	"hash_algorithm" varchar(24) DEFAULT 'SHA256' NOT NULL,
	"source_comment_version" integer NOT NULL,
	"publication_state" varchar(32) NOT NULL,
	"visibility" varchar(32) NOT NULL,
	"integrity_state" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_revisions_comment_revision_unique" UNIQUE("comment_id","revision"),
	CONSTRAINT "comment_revisions_positive_revision_check" CHECK ("comment_revisions"."revision" > 0),
	CONSTRAINT "comment_revisions_operation_check" CHECK ("comment_revisions"."operation" in ('CREATED', 'EDITED', 'AUTHOR_REMOVED', 'LEGACY_BACKFILL')),
	CONSTRAINT "comment_revisions_hash_algorithm_check" CHECK ("comment_revisions"."hash_algorithm" in ('SHA256', 'LEGACY_MD5_PAIR'))
);
--> statement-breakpoint
CREATE TABLE "content_retention_directives" (
	"content_retention_directive_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" varchar(32) NOT NULL,
	"target_id" uuid NOT NULL,
	"target_version" integer,
	"directive_type" varchar(32) NOT NULL,
	"precedence" integer NOT NULL,
	"reason" text NOT NULL,
	"reference" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "content_retention_directives_type_check" CHECK ("content_retention_directives"."directive_type" in ('CONTENT_DELETION', 'MEMBER_DELETION', 'APPEAL', 'RIGHTS', 'LEGAL_HOLD')),
	CONSTRAINT "content_retention_directives_precedence_check" CHECK (("content_retention_directives"."directive_type" = 'CONTENT_DELETION' and "content_retention_directives"."precedence" = 100)
        or ("content_retention_directives"."directive_type" = 'MEMBER_DELETION' and "content_retention_directives"."precedence" = 200)
        or ("content_retention_directives"."directive_type" = 'APPEAL' and "content_retention_directives"."precedence" = 300)
        or ("content_retention_directives"."directive_type" = 'RIGHTS' and "content_retention_directives"."precedence" = 400)
        or ("content_retention_directives"."directive_type" = 'LEGAL_HOLD' and "content_retention_directives"."precedence" = 500))
);
--> statement-breakpoint
CREATE TABLE "issue_choice_media_revisions" (
	"issue_id" uuid NOT NULL,
	"issue_version" integer NOT NULL,
	"choice_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"operation" varchar(24) NOT NULL,
	"media_asset_id" uuid,
	"media_asset_version" integer,
	"media_sha256" varchar(64),
	"alt_text" varchar(300),
	"crop_mode" varchar(16),
	"display_position" integer,
	"rights_attestation" text,
	"linked_by_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_choice_media_revisions_pk" PRIMARY KEY("issue_id","issue_version","choice_id","revision"),
	CONSTRAINT "issue_choice_media_revisions_positive_revision_check" CHECK ("issue_choice_media_revisions"."revision" > 0),
	CONSTRAINT "issue_choice_media_revisions_operation_check" CHECK ("issue_choice_media_revisions"."operation" in ('ATTACHED', 'REPLACED', 'DETACHED', 'LEGACY_BACKFILL')),
	CONSTRAINT "issue_choice_media_revisions_shape_check" CHECK (("issue_choice_media_revisions"."operation" = 'DETACHED' and "issue_choice_media_revisions"."media_asset_id" is null)
        or ("issue_choice_media_revisions"."operation" <> 'DETACHED' and "issue_choice_media_revisions"."media_asset_id" is not null and "issue_choice_media_revisions"."media_asset_version" is not null and "issue_choice_media_revisions"."media_sha256" is not null))
);
--> statement-breakpoint
CREATE TABLE "issue_media_asset_versions" (
	"media_asset_id" uuid NOT NULL,
	"asset_version" integer NOT NULL,
	"source_type" varchar(32) NOT NULL,
	"rights_attestation" text NOT NULL,
	"rights_attested_at" timestamp with time zone NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"perceptual_hash" varchar(16) NOT NULL,
	"input_mime_type" varchar(32) NOT NULL,
	"input_byte_size" integer NOT NULL,
	"input_width" integer NOT NULL,
	"input_height" integer NOT NULL,
	"output_mime_type" varchar(32) NOT NULL,
	"output_byte_size" integer NOT NULL,
	"output_width" integer NOT NULL,
	"output_height" integer NOT NULL,
	"normalized_object_ref" varchar(512) NOT NULL,
	"input_hash" varchar(64) NOT NULL,
	"hash_algorithm" varchar(24) DEFAULT 'SHA256' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_media_asset_versions_pk" PRIMARY KEY("media_asset_id","asset_version"),
	CONSTRAINT "issue_media_asset_versions_sha256_unique" UNIQUE("sha256"),
	CONSTRAINT "issue_media_asset_versions_positive_version_check" CHECK ("issue_media_asset_versions"."asset_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "issue_version_snapshots" (
	"issue_id" uuid NOT NULL,
	"issue_version" integer NOT NULL,
	"question" text NOT NULL,
	"context" text,
	"choices_snapshot" jsonb NOT NULL,
	"media_snapshot" jsonb NOT NULL,
	"source_content_hash" varchar(64) NOT NULL,
	"input_hash" varchar(64) NOT NULL,
	"policy_version" varchar(64) NOT NULL,
	"sealed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_version_snapshots_pk" PRIMARY KEY("issue_id","issue_version")
);
--> statement-breakpoint
CREATE TABLE "moderation_recheck_requests" (
	"moderation_recheck_request_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" varchar(32) NOT NULL,
	"target_id" uuid NOT NULL,
	"target_version" integer NOT NULL,
	"policy_version" varchar(64) NOT NULL,
	"input_hash" varchar(64) NOT NULL,
	"normalized_snapshot_ref" varchar(512) NOT NULL,
	"ocr_transcript_ref" varchar(512),
	"reason" varchar(24) NOT NULL,
	"status" varchar(24) DEFAULT 'PENDING' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_reason" text,
	CONSTRAINT "moderation_recheck_requests_natural_key_unique" UNIQUE("target_type","target_id","target_version","policy_version","input_hash"),
	CONSTRAINT "moderation_recheck_requests_positive_version_check" CHECK ("moderation_recheck_requests"."target_version" > 0),
	CONSTRAINT "moderation_recheck_requests_target_type_check" CHECK ("moderation_recheck_requests"."target_type" in ('COMMENT_REVISION', 'ISSUE_VERSION', 'MEDIA_ASSET_VERSION')),
	CONSTRAINT "moderation_recheck_requests_reason_check" CHECK ("moderation_recheck_requests"."reason" in ('CREATE', 'EDIT', 'REPLACEMENT', 'POLICY_CHANGE', 'APPEAL', 'RIGHTS', 'BACKFILL')),
	CONSTRAINT "moderation_recheck_requests_status_check" CHECK ("moderation_recheck_requests"."status" in ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'))
);
--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "body_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "comment_revisions" ADD CONSTRAINT "comment_revisions_comment_id_comments_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("comment_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_choice_media_revisions" ADD CONSTRAINT "issue_choice_media_revisions_media_asset_id_issue_media_assets_media_asset_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."issue_media_assets"("media_asset_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_choice_media_revisions" ADD CONSTRAINT "issue_choice_media_revisions_issue_version_fk" FOREIGN KEY ("issue_id","issue_version") REFERENCES "public"."issue_versions"("issue_id","issue_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_media_asset_versions" ADD CONSTRAINT "issue_media_asset_versions_media_asset_id_issue_media_assets_media_asset_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."issue_media_assets"("media_asset_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_version_snapshots" ADD CONSTRAINT "issue_version_snapshots_issue_version_fk" FOREIGN KEY ("issue_id","issue_version") REFERENCES "public"."issue_versions"("issue_id","issue_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_revisions_comment_created_idx" ON "comment_revisions" USING btree ("comment_id","created_at");--> statement-breakpoint
CREATE INDEX "content_retention_directives_target_idx" ON "content_retention_directives" USING btree ("target_type","target_id","target_version","created_at");--> statement-breakpoint
CREATE INDEX "issue_choice_media_revisions_asset_idx" ON "issue_choice_media_revisions" USING btree ("media_asset_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_recheck_requests_status_requested_idx" ON "moderation_recheck_requests" USING btree ("status","requested_at");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_positive_body_revision_check" CHECK ("comments"."body_revision" > 0);--> statement-breakpoint
INSERT INTO "comment_revisions" (
  "comment_id", "revision", "operation", "body", "text_policy_version", "input_hash",
  "hash_algorithm", "source_comment_version", "publication_state", "visibility",
  "integrity_state", "created_at"
)
SELECT
  "comment_id", 1, 'LEGACY_BACKFILL', "body", "text_policy_version",
  md5("body") || md5('which-93:' || "body"), 'LEGACY_MD5_PAIR', "version",
  "publication_state"::text, "visibility"::text, "integrity_state"::text, "created_at"
FROM "comments"
ON CONFLICT ("comment_id", "revision") DO NOTHING;--> statement-breakpoint
INSERT INTO "issue_media_asset_versions" (
  "media_asset_id", "asset_version", "source_type", "rights_attestation", "rights_attested_at",
  "sha256", "perceptual_hash", "input_mime_type", "input_byte_size", "input_width",
  "input_height", "output_mime_type", "output_byte_size", "output_width", "output_height",
  "normalized_object_ref", "input_hash", "hash_algorithm", "created_at"
)
SELECT
  "media_asset_id", 1, "source_type", "rights_attestation", "rights_attested_at",
  "sha256", "perceptual_hash", "input_mime_type", "input_byte_size", "input_width",
  "input_height", "output_mime_type", "output_byte_size", "output_width", "output_height",
  'issue-media://asset/' || "media_asset_id"::text || '/version/1',
  "sha256", 'SHA256', "created_at"
FROM "issue_media_assets"
ON CONFLICT ("media_asset_id", "asset_version") DO NOTHING;--> statement-breakpoint
INSERT INTO "issue_choice_media_revisions" (
  "issue_id", "issue_version", "choice_id", "revision", "operation", "media_asset_id",
  "media_asset_version", "media_sha256", "alt_text", "crop_mode", "display_position",
  "rights_attestation", "linked_by_member_id", "created_at"
)
SELECT
  link."issue_id", link."issue_version", link."choice_id", 1, 'LEGACY_BACKFILL',
  link."media_asset_id", 1, asset."sha256", link."alt_text", link."crop_mode",
  link."display_position", asset."rights_attestation", link."linked_by_member_id", link."created_at"
FROM "issue_choice_media" link
JOIN "issue_media_assets" asset ON asset."media_asset_id" = link."media_asset_id"
ON CONFLICT ("issue_id", "issue_version", "choice_id", "revision") DO NOTHING;--> statement-breakpoint
INSERT INTO "issue_version_snapshots" (
  "issue_id", "issue_version", "question", "context", "choices_snapshot", "media_snapshot",
  "source_content_hash", "input_hash", "policy_version", "sealed_at"
)
SELECT
  version."issue_id",
  version."issue_version",
  version."question",
  version."context",
  COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object('id', choice."choice_id", 'code', choice."choice_code", 'label', choice."label")
      ORDER BY choice."choice_code", choice."choice_id"
    )
    FROM "issue_choices" choice
    WHERE choice."issue_id" = version."issue_id"
      AND choice."issue_version" = version."issue_version"
  ), '[]'::jsonb),
  COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'choiceId', link."choice_id",
        'choiceCode', choice."choice_code",
        'assetId', link."media_asset_id",
        'assetVersion', 1,
        'sha256', asset."sha256",
        'altText', link."alt_text",
        'cropMode', link."crop_mode",
        'displayPosition', link."display_position",
        'rightsAttestation', asset."rights_attestation"
      ) ORDER BY link."display_position", link."choice_id"
    )
    FROM "issue_choice_media" link
    JOIN "issue_choices" choice
      ON choice."issue_id" = link."issue_id"
      AND choice."issue_version" = link."issue_version"
      AND choice."choice_id" = link."choice_id"
    JOIN "issue_media_assets" asset ON asset."media_asset_id" = link."media_asset_id"
    WHERE link."issue_id" = version."issue_id"
      AND link."issue_version" = version."issue_version"
  ), '[]'::jsonb),
  version."content_hash",
  md5(version."content_hash") || md5('which-93:' || version."content_hash"),
  'issue-snapshot-legacy-md5-pair-v1',
  COALESCE(version."published_at", version."locked_at", version."created_at")
FROM "issue_versions" version
ON CONFLICT ("issue_id", "issue_version") DO NOTHING;
