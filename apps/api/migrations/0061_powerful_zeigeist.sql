CREATE TABLE "operator_editorial_candidate_media" (
	"operator_editorial_candidate_media_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"catalog_id" varchar(128) NOT NULL,
	"candidate_id" varchar(32) NOT NULL,
	"choice_code" varchar(1) NOT NULL,
	"target_issue_id" uuid NOT NULL,
	"target_issue_version" integer NOT NULL,
	"target_choice_id" uuid NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"alt_text" varchar(300) NOT NULL,
	"crop_mode" varchar(16) DEFAULT 'COVER' NOT NULL,
	"linked_by_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_editorial_candidate_media_choice_unique" UNIQUE("catalog_id","candidate_id","choice_code"),
	CONSTRAINT "operator_editorial_candidate_media_asset_unique" UNIQUE("media_asset_id"),
	CONSTRAINT "operator_editorial_candidate_media_target_choice_unique" UNIQUE("target_issue_id","target_issue_version","target_choice_id"),
	CONSTRAINT "operator_editorial_candidate_media_choice_code_check" CHECK ("operator_editorial_candidate_media"."choice_code" in ('A', 'B', 'C', 'D')),
	CONSTRAINT "operator_editorial_candidate_media_alt_text_check" CHECK (char_length("operator_editorial_candidate_media"."alt_text") between 2 and 300),
	CONSTRAINT "operator_editorial_candidate_media_crop_mode_check" CHECK ("operator_editorial_candidate_media"."crop_mode" in ('COVER', 'CONTAIN')),
	CONSTRAINT "operator_editorial_candidate_media_target_version_check" CHECK ("operator_editorial_candidate_media"."target_issue_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "operator_editorial_candidate_media" ADD CONSTRAINT "operator_editorial_candidate_media_media_asset_id_issue_media_assets_media_asset_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."issue_media_assets"("media_asset_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_editorial_candidate_media" ADD CONSTRAINT "operator_editorial_candidate_media_linked_by_member_id_members_member_id_fk" FOREIGN KEY ("linked_by_member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operator_editorial_candidate_media_candidate_idx" ON "operator_editorial_candidate_media" USING btree ("catalog_id","candidate_id");