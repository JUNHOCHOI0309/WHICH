CREATE TABLE "auth_rate_limit_windows" (
	"auth_rate_limit_window_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" varchar(32) NOT NULL,
	"bucket_key_hash" varchar(64) NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"attempt_count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_rate_limit_windows_bucket_unique" UNIQUE("action","bucket_key_hash","window_started_at"),
	CONSTRAINT "auth_rate_limit_windows_attempt_count_check" CHECK ("auth_rate_limit_windows"."attempt_count" > 0),
	CONSTRAINT "auth_rate_limit_windows_expiry_check" CHECK ("auth_rate_limit_windows"."expires_at" > "auth_rate_limit_windows"."window_started_at")
);
--> statement-breakpoint
CREATE TABLE "member_auth_tokens" (
	"member_auth_token_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_credential_id" uuid NOT NULL,
	"purpose" varchar(32) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_auth_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "member_auth_tokens_purpose_check" CHECK ("member_auth_tokens"."purpose" in ('EMAIL_VERIFICATION', 'PASSWORD_RESET')),
	CONSTRAINT "member_auth_tokens_expiry_check" CHECK ("member_auth_tokens"."expires_at" > "member_auth_tokens"."created_at")
);
--> statement-breakpoint
ALTER TABLE "member_auth_tokens" ADD CONSTRAINT "member_auth_tokens_member_credential_id_member_credentials_member_credential_id_fk" FOREIGN KEY ("member_credential_id") REFERENCES "public"."member_credentials"("member_credential_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_rate_limit_windows_expiry_idx" ON "auth_rate_limit_windows" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "member_auth_tokens_credential_purpose_idx" ON "member_auth_tokens" USING btree ("member_credential_id","purpose","created_at");--> statement-breakpoint
CREATE INDEX "member_auth_tokens_active_expiry_idx" ON "member_auth_tokens" USING btree ("expires_at") WHERE "member_auth_tokens"."consumed_at" is null;