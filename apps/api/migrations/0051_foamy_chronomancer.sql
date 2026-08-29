CREATE TABLE "issue_media_library_assets" (
	"library_asset_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"library_pair_id" uuid NOT NULL,
	"side" varchar(1) NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"alt_text" varchar(300) NOT NULL,
	"crop_mode" varchar(16) DEFAULT 'COVER' NOT NULL,
	"source_url" text NOT NULL,
	"author_name" varchar(200) NOT NULL,
	"license_name" varchar(160) NOT NULL,
	"license_version" varchar(80) NOT NULL,
	"acquired_at" timestamp with time zone NOT NULL,
	"commercial_allowed" boolean NOT NULL,
	"derivative_allowed" boolean NOT NULL,
	"redistribution_allowed" boolean NOT NULL,
	"attribution_text" text,
	"evidence_reference" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_media_library_assets_pair_side_unique" UNIQUE("library_pair_id","side"),
	CONSTRAINT "issue_media_library_assets_media_unique" UNIQUE("media_asset_id"),
	CONSTRAINT "issue_media_library_assets_side_check" CHECK ("issue_media_library_assets"."side" in ('A', 'B')),
	CONSTRAINT "issue_media_library_assets_alt_check" CHECK (char_length("issue_media_library_assets"."alt_text") between 2 and 300),
	CONSTRAINT "issue_media_library_assets_crop_check" CHECK ("issue_media_library_assets"."crop_mode" in ('COVER', 'CONTAIN')),
	CONSTRAINT "issue_media_library_assets_rights_check" CHECK ("issue_media_library_assets"."commercial_allowed" and "issue_media_library_assets"."redistribution_allowed"
        and char_length("issue_media_library_assets"."source_url") between 8 and 2000
        and char_length("issue_media_library_assets"."evidence_reference") between 8 and 2000)
);
--> statement-breakpoint
CREATE TABLE "issue_media_library_pairs" (
	"library_pair_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(160) NOT NULL,
	"category_code" varchar(64) NOT NULL,
	"topics" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"status" varchar(24) DEFAULT 'PUBLISHED' NOT NULL,
	"created_by_member_id" uuid NOT NULL,
	"revoked_by_member_id" uuid,
	"revoke_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "issue_media_library_pairs_status_check" CHECK ("issue_media_library_pairs"."status" in ('PUBLISHED', 'REVOKED')),
	CONSTRAINT "issue_media_library_pairs_revoke_check" CHECK (("issue_media_library_pairs"."status" = 'PUBLISHED' and "issue_media_library_pairs"."revoked_at" is null and "issue_media_library_pairs"."revoked_by_member_id" is null)
        or ("issue_media_library_pairs"."status" = 'REVOKED' and "issue_media_library_pairs"."revoked_at" is not null and "issue_media_library_pairs"."revoked_by_member_id" is not null and char_length("issue_media_library_pairs"."revoke_reason") between 10 and 2000))
);
--> statement-breakpoint
CREATE TABLE "issue_media_library_usages" (
	"library_usage_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"library_pair_id" uuid NOT NULL,
	"library_asset_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"issue_version" integer NOT NULL,
	"choice_id" uuid NOT NULL,
	"side" varchar(1) NOT NULL,
	"selected_by_member_id" uuid NOT NULL,
	"status" varchar(24) DEFAULT 'ACTIVE' NOT NULL,
	"fallback_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_media_library_usages_choice_unique" UNIQUE("issue_id","issue_version","choice_id"),
	CONSTRAINT "issue_media_library_usages_side_check" CHECK ("issue_media_library_usages"."side" in ('A', 'B')),
	CONSTRAINT "issue_media_library_usages_status_check" CHECK ("issue_media_library_usages"."status" in ('ACTIVE', 'TEXT_FALLBACK', 'REPLACED')),
	CONSTRAINT "issue_media_library_usages_fallback_check" CHECK ("issue_media_library_usages"."status" = 'ACTIVE' or char_length("issue_media_library_usages"."fallback_reason") between 10 and 2000)
);
--> statement-breakpoint
ALTER TABLE "issue_choice_media" DROP CONSTRAINT "issue_choice_media_asset_unique";--> statement-breakpoint
ALTER TABLE "issue_media_library_assets" ADD CONSTRAINT "issue_media_library_assets_library_pair_id_issue_media_library_pairs_library_pair_id_fk" FOREIGN KEY ("library_pair_id") REFERENCES "public"."issue_media_library_pairs"("library_pair_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_media_library_assets" ADD CONSTRAINT "issue_media_library_assets_media_asset_id_issue_media_assets_media_asset_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."issue_media_assets"("media_asset_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_media_library_pairs" ADD CONSTRAINT "issue_media_library_pairs_created_by_member_id_members_member_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_media_library_pairs" ADD CONSTRAINT "issue_media_library_pairs_revoked_by_member_id_members_member_id_fk" FOREIGN KEY ("revoked_by_member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_media_library_usages" ADD CONSTRAINT "issue_media_library_usages_library_pair_id_issue_media_library_pairs_library_pair_id_fk" FOREIGN KEY ("library_pair_id") REFERENCES "public"."issue_media_library_pairs"("library_pair_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_media_library_usages" ADD CONSTRAINT "issue_media_library_usages_library_asset_id_issue_media_library_assets_library_asset_id_fk" FOREIGN KEY ("library_asset_id") REFERENCES "public"."issue_media_library_assets"("library_asset_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_media_library_usages" ADD CONSTRAINT "issue_media_library_usages_selected_by_member_id_members_member_id_fk" FOREIGN KEY ("selected_by_member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_media_library_usages" ADD CONSTRAINT "issue_media_library_usages_choice_fk" FOREIGN KEY ("issue_id","issue_version","choice_id") REFERENCES "public"."issue_choices"("issue_id","issue_version","choice_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_media_library_assets_expiry_idx" ON "issue_media_library_assets" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "issue_media_library_pairs_discovery_idx" ON "issue_media_library_pairs" USING btree ("status","category_code","created_at");--> statement-breakpoint
CREATE INDEX "issue_media_library_usages_pair_status_idx" ON "issue_media_library_usages" USING btree ("library_pair_id","status");--> statement-breakpoint
CREATE INDEX "issue_media_library_usages_asset_status_idx" ON "issue_media_library_usages" USING btree ("library_asset_id","status");
