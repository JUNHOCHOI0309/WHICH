CREATE TYPE "public"."point_ledger_entry_type" AS ENUM('EARN', 'SPEND', 'REFUND', 'REVERSAL', 'ADJUSTMENT');--> statement-breakpoint
CREATE TABLE "point_accounts" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"cached_balance" integer DEFAULT 0 NOT NULL,
	"lifetime_earned" integer DEFAULT 0 NOT NULL,
	"lifetime_spent" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "point_accounts_balance_nonnegative_check" CHECK ("point_accounts"."cached_balance" >= 0),
	CONSTRAINT "point_accounts_lifetime_earned_check" CHECK ("point_accounts"."lifetime_earned" >= 0),
	CONSTRAINT "point_accounts_lifetime_spent_check" CHECK ("point_accounts"."lifetime_spent" >= 0),
	CONSTRAINT "point_accounts_version_check" CHECK ("point_accounts"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "point_daily_counters" (
	"member_id" uuid NOT NULL,
	"operation_day" date NOT NULL,
	"counter_key" varchar(64) NOT NULL,
	"qualifying_count" integer DEFAULT 0 NOT NULL,
	"awarded_points" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "point_daily_counters_pk" PRIMARY KEY("member_id","operation_day","counter_key"),
	CONSTRAINT "point_daily_counters_count_check" CHECK ("point_daily_counters"."qualifying_count" >= 0),
	CONSTRAINT "point_daily_counters_points_check" CHECK ("point_daily_counters"."awarded_points" >= 0)
);
--> statement-breakpoint
CREATE TABLE "point_ledger_entries" (
	"point_ledger_entry_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"entry_type" "point_ledger_entry_type" NOT NULL,
	"amount" integer NOT NULL,
	"reason_code" varchar(64) NOT NULL,
	"source_type" varchar(64) NOT NULL,
	"source_id" varchar(160) NOT NULL,
	"operation_day" date NOT NULL,
	"reverses_entry_id" uuid,
	"idempotency_key" varchar(160) NOT NULL,
	"policy_version" varchar(32) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "point_ledger_entries_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "point_ledger_entries_source_reason_unique" UNIQUE("source_type","source_id","reason_code"),
	CONSTRAINT "point_ledger_entries_amount_shape_check" CHECK ((
        "point_ledger_entries"."entry_type" in ('EARN', 'REFUND') and "point_ledger_entries"."amount" > 0
      ) or (
        "point_ledger_entries"."entry_type" in ('SPEND', 'REVERSAL') and "point_ledger_entries"."amount" < 0
      ) or (
        "point_ledger_entries"."entry_type" = 'ADJUSTMENT' and "point_ledger_entries"."amount" <> 0
      )),
	CONSTRAINT "point_ledger_entries_reversal_shape_check" CHECK (("point_ledger_entries"."entry_type" = 'REVERSAL' and "point_ledger_entries"."reverses_entry_id" is not null)
        or ("point_ledger_entries"."entry_type" <> 'REVERSAL' and "point_ledger_entries"."reverses_entry_id" is null)),
	CONSTRAINT "point_ledger_entries_not_self_reversal_check" CHECK ("point_ledger_entries"."reverses_entry_id" is null or "point_ledger_entries"."reverses_entry_id" <> "point_ledger_entries"."point_ledger_entry_id")
);
--> statement-breakpoint
ALTER TABLE "point_accounts" ADD CONSTRAINT "point_accounts_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_daily_counters" ADD CONSTRAINT "point_daily_counters_member_id_point_accounts_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."point_accounts"("member_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_ledger_entries" ADD CONSTRAINT "point_ledger_entries_member_id_point_accounts_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."point_accounts"("member_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_ledger_entries" ADD CONSTRAINT "point_ledger_entries_reverses_entry_fk" FOREIGN KEY ("reverses_entry_id") REFERENCES "public"."point_ledger_entries"("point_ledger_entry_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "point_accounts_updated_idx" ON "point_accounts" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "point_daily_counters_day_key_idx" ON "point_daily_counters" USING btree ("operation_day","counter_key");--> statement-breakpoint
CREATE UNIQUE INDEX "point_ledger_entries_reversal_unique" ON "point_ledger_entries" USING btree ("reverses_entry_id") WHERE "point_ledger_entries"."reverses_entry_id" is not null;--> statement-breakpoint
CREATE INDEX "point_ledger_entries_member_created_idx" ON "point_ledger_entries" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "point_ledger_entries_operation_reason_idx" ON "point_ledger_entries" USING btree ("operation_day","reason_code");--> statement-breakpoint
CREATE FUNCTION prevent_point_ledger_entry_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'point ledger entries are immutable'
		USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint
CREATE TRIGGER point_ledger_entries_immutable_guard
BEFORE UPDATE OR DELETE ON point_ledger_entries
FOR EACH ROW
EXECUTE FUNCTION prevent_point_ledger_entry_mutation();
