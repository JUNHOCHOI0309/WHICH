CREATE TYPE "public"."identity_provider" AS ENUM('GOOGLE', 'DEVELOPMENT');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('ACTIVE', 'LIMITED', 'SUSPENDED', 'DELETED');--> statement-breakpoint
CREATE TABLE "guest_member_links" (
	"guest_member_link_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guest_subject_id" uuid NOT NULL,
	"member_subject_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"provider" "identity_provider" NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_member_links_distinct_subjects_check" CHECK ("guest_member_links"."guest_subject_id" <> "guest_member_links"."member_subject_id")
);
--> statement-breakpoint
CREATE TABLE "member_identity_links" (
	"identity_link_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"provider" "identity_provider" NOT NULL,
	"provider_subject" varchar(255) NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_authenticated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_identity_links_provider_subject_unique" UNIQUE("provider","provider_subject")
);
--> statement-breakpoint
CREATE TABLE "member_sessions" (
	"member_session_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "member_sessions_expiry_check" CHECK ("member_sessions"."expires_at" > "member_sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"member_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "member_status" DEFAULT 'ACTIVE' NOT NULL,
	"display_name" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guest_member_links" ADD CONSTRAINT "guest_member_links_guest_subject_id_voter_subjects_subject_id_fk" FOREIGN KEY ("guest_subject_id") REFERENCES "public"."voter_subjects"("subject_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_member_links" ADD CONSTRAINT "guest_member_links_member_subject_id_voter_subjects_subject_id_fk" FOREIGN KEY ("member_subject_id") REFERENCES "public"."voter_subjects"("subject_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_member_links" ADD CONSTRAINT "guest_member_links_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_identity_links" ADD CONSTRAINT "member_identity_links_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_sessions" ADD CONSTRAINT "member_sessions_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guest_member_links_guest_unique" ON "guest_member_links" USING btree ("guest_subject_id");--> statement-breakpoint
CREATE INDEX "guest_member_links_member_idx" ON "guest_member_links" USING btree ("member_id","linked_at");--> statement-breakpoint
CREATE INDEX "member_identity_links_member_idx" ON "member_identity_links" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "member_sessions_member_created_idx" ON "member_sessions" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "member_sessions_active_expiry_idx" ON "member_sessions" USING btree ("expires_at") WHERE "member_sessions"."revoked_at" is null;