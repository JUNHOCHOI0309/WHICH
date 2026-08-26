CREATE TABLE "issue_choice_media" (
	"issue_id" uuid NOT NULL,
	"issue_version" integer NOT NULL,
	"choice_id" uuid NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"alt_text" varchar(300) NOT NULL,
	"crop_mode" varchar(16) DEFAULT 'COVER' NOT NULL,
	"display_position" integer NOT NULL,
	"linked_by_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_choice_media_pk" PRIMARY KEY("issue_id","issue_version","choice_id"),
	CONSTRAINT "issue_choice_media_asset_unique" UNIQUE("media_asset_id"),
	CONSTRAINT "issue_choice_media_position_unique" UNIQUE("issue_id","issue_version","display_position"),
	CONSTRAINT "issue_choice_media_alt_text_check" CHECK (char_length("issue_choice_media"."alt_text") between 2 and 300),
	CONSTRAINT "issue_choice_media_crop_mode_check" CHECK ("issue_choice_media"."crop_mode" in ('COVER', 'CONTAIN')),
	CONSTRAINT "issue_choice_media_position_check" CHECK ("issue_choice_media"."display_position" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "issue_media_assets" (
	"media_asset_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uploaded_by_member_id" uuid NOT NULL,
	"source_type" varchar(32) NOT NULL,
	"rights_attestation" text NOT NULL,
	"rights_attested_at" timestamp with time zone NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"perceptual_hash" varchar(16) NOT NULL,
	"input_mime_type" varchar(32) NOT NULL,
	"input_byte_size" integer NOT NULL,
	"input_width" integer NOT NULL,
	"input_height" integer NOT NULL,
	"output_mime_type" varchar(32) DEFAULT 'image/webp' NOT NULL,
	"output_byte_size" integer NOT NULL,
	"output_width" integer NOT NULL,
	"output_height" integer NOT NULL,
	"processing_state" varchar(24) DEFAULT 'READY' NOT NULL,
	"moderation_state" varchar(24) DEFAULT 'PENDING' NOT NULL,
	"storage_state" varchar(24) DEFAULT 'STAGED' NOT NULL,
	"rights_state" varchar(24) DEFAULT 'ASSERTED' NOT NULL,
	"staging_object_key" varchar(512),
	"published_object_key" varchar(512),
	"quarantined_object_key" varchar(512),
	"staged_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"quarantined_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_media_assets_sha256_unique" UNIQUE("sha256"),
	CONSTRAINT "issue_media_assets_source_type_check" CHECK ("issue_media_assets"."source_type" = 'OPERATOR_UPLOAD'),
	CONSTRAINT "issue_media_assets_processing_state_check" CHECK ("issue_media_assets"."processing_state" in ('PENDING', 'PROCESSING', 'READY', 'FAILED')),
	CONSTRAINT "issue_media_assets_moderation_state_check" CHECK ("issue_media_assets"."moderation_state" in ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED')),
	CONSTRAINT "issue_media_assets_storage_state_check" CHECK ("issue_media_assets"."storage_state" in ('STAGED', 'PUBLISHED', 'QUARANTINED', 'PURGED')),
	CONSTRAINT "issue_media_assets_rights_state_check" CHECK ("issue_media_assets"."rights_state" in ('ASSERTED', 'CHALLENGED', 'CLEARED', 'WITHDRAWN')),
	CONSTRAINT "issue_media_assets_mime_check" CHECK ("issue_media_assets"."input_mime_type" in ('image/jpeg', 'image/png', 'image/webp') and "issue_media_assets"."output_mime_type" = 'image/webp'),
	CONSTRAINT "issue_media_assets_dimensions_check" CHECK ("issue_media_assets"."input_byte_size" > 0 and "issue_media_assets"."output_byte_size" > 0 and "issue_media_assets"."input_width" > 0 and "issue_media_assets"."input_height" > 0 and "issue_media_assets"."output_width" > 0 and "issue_media_assets"."output_height" > 0),
	CONSTRAINT "issue_media_assets_attestation_check" CHECK (char_length("issue_media_assets"."rights_attestation") between 20 and 2000),
	CONSTRAINT "issue_media_assets_storage_keys_check" CHECK (("issue_media_assets"."storage_state" <> 'STAGED' or "issue_media_assets"."staging_object_key" is not null)
        and ("issue_media_assets"."storage_state" <> 'PUBLISHED' or "issue_media_assets"."published_object_key" is not null)
        and ("issue_media_assets"."storage_state" <> 'QUARANTINED' or "issue_media_assets"."quarantined_object_key" is not null)
        and ("issue_media_assets"."storage_state" <> 'PURGED' or "issue_media_assets"."purged_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "issue_versions" ADD COLUMN "format_mode" varchar(24) DEFAULT 'VS' NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_versions" ADD COLUMN "media_mode" varchar(24) DEFAULT 'TEXT_ONLY' NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_choice_media" ADD CONSTRAINT "issue_choice_media_media_asset_id_issue_media_assets_media_asset_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."issue_media_assets"("media_asset_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_choice_media" ADD CONSTRAINT "issue_choice_media_linked_by_member_id_members_member_id_fk" FOREIGN KEY ("linked_by_member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_choice_media" ADD CONSTRAINT "issue_choice_media_choice_fk" FOREIGN KEY ("issue_id","issue_version","choice_id") REFERENCES "public"."issue_choices"("issue_id","issue_version","choice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_media_assets" ADD CONSTRAINT "issue_media_assets_uploaded_by_member_id_members_member_id_fk" FOREIGN KEY ("uploaded_by_member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_media_assets_lifecycle_idx" ON "issue_media_assets" USING btree ("storage_state","moderation_state","updated_at");--> statement-breakpoint
CREATE INDEX "issue_media_assets_perceptual_hash_idx" ON "issue_media_assets" USING btree ("perceptual_hash");--> statement-breakpoint
ALTER TABLE "issue_versions" ADD CONSTRAINT "issue_versions_format_mode_check" CHECK ("issue_versions"."format_mode" in ('VS'));--> statement-breakpoint
ALTER TABLE "issue_versions" ADD CONSTRAINT "issue_versions_media_mode_check" CHECK ("issue_versions"."media_mode" in ('TEXT_ONLY', 'OPTION_IMAGES'));