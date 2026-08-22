ALTER TYPE "public"."identity_provider" ADD VALUE 'EMAIL' BEFORE 'GOOGLE';--> statement-breakpoint
CREATE TABLE "member_credentials" (
	"member_credential_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"email_normalized" varchar(320) NOT NULL,
	"password_hash" varchar(512) NOT NULL,
	"email_verified_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_credentials_member_unique" UNIQUE("member_id"),
	CONSTRAINT "member_credentials_email_unique" UNIQUE("email_normalized")
);
--> statement-breakpoint
ALTER TABLE "member_credentials" ADD CONSTRAINT "member_credentials_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;