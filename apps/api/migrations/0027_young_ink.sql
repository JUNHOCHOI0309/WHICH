CREATE TABLE "member_daily_attendances" (
	"member_daily_attendance_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"operation_day" date NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_daily_attendances_member_day_unique" UNIQUE("member_id","operation_day")
);
--> statement-breakpoint
CREATE TABLE "point_event_receipts" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"outcome" varchar(24) NOT NULL,
	"policy_version" varchar(32) NOT NULL,
	"operation_day" date NOT NULL,
	"ledger_entry_id" uuid,
	"detail" varchar(160),
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "point_event_receipts_outcome_check" CHECK ("point_event_receipts"."outcome" in ('AWARDED', 'DUPLICATE', 'CAP_REACHED', 'INELIGIBLE', 'DISABLED'))
);
--> statement-breakpoint
CREATE TABLE "share_reward_claims" (
	"share_reward_claim_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"share_card_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"issue_version" integer NOT NULL,
	"share_channel" varchar(16) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_reward_claims_idempotency_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "share_reward_claims_member_issue_unique" UNIQUE("member_id","issue_id"),
	CONSTRAINT "share_reward_claims_channel_check" CHECK ("share_reward_claims"."share_channel" in ('COPY', 'SYSTEM', 'X'))
);
--> statement-breakpoint
ALTER TABLE "member_daily_attendances" ADD CONSTRAINT "member_daily_attendances_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_event_receipts" ADD CONSTRAINT "point_event_receipts_ledger_entry_id_point_ledger_entries_point_ledger_entry_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."point_ledger_entries"("point_ledger_entry_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_reward_claims" ADD CONSTRAINT "share_reward_claims_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_reward_claims" ADD CONSTRAINT "share_reward_claims_share_card_id_share_cards_share_card_id_fk" FOREIGN KEY ("share_card_id") REFERENCES "public"."share_cards"("share_card_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_reward_claims" ADD CONSTRAINT "share_reward_claims_issue_version_fk" FOREIGN KEY ("issue_id","issue_version") REFERENCES "public"."issue_versions"("issue_id","issue_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_daily_attendances_day_idx" ON "member_daily_attendances" USING btree ("operation_day","occurred_at");--> statement-breakpoint
CREATE INDEX "point_event_receipts_processed_idx" ON "point_event_receipts" USING btree ("processed_at");