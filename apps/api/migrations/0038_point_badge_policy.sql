CREATE TABLE "point_badge_policies" (
	"policy_version" varchar(32) NOT NULL,
	"badge_code" varchar(16) NOT NULL,
	"label" varchar(32) NOT NULL,
	"minimum_lifetime_points" integer NOT NULL,
	"display_order" integer NOT NULL,
	"asset_key" varchar(128) NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "point_badge_policies_pk" PRIMARY KEY("policy_version","badge_code"),
	CONSTRAINT "point_badge_policies_threshold_unique" UNIQUE("policy_version","minimum_lifetime_points"),
	CONSTRAINT "point_badge_policies_order_unique" UNIQUE("policy_version","display_order"),
	CONSTRAINT "point_badge_policies_badge_code_check" CHECK ("badge_code" in ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND')),
	CONSTRAINT "point_badge_policies_threshold_check" CHECK ("minimum_lifetime_points" > 0),
	CONSTRAINT "point_badge_policies_order_check" CHECK ("display_order" > 0),
	CONSTRAINT "point_badge_policies_period_check" CHECK ("retired_at" is null or "retired_at" > "effective_at")
);
--> statement-breakpoint
INSERT INTO "point_badge_policies" (
	"policy_version", "badge_code", "label", "minimum_lifetime_points", "display_order", "asset_key", "effective_at"
) VALUES
	('w_badge_v1', 'BRONZE', '브론즈', 10, 1, 'bronze.webp', '2026-08-28T00:00:00+09:00'),
	('w_badge_v1', 'SILVER', '실버', 1000, 2, 'silver.webp', '2026-08-28T00:00:00+09:00'),
	('w_badge_v1', 'GOLD', '골드', 5000, 3, 'gold.webp', '2026-08-28T00:00:00+09:00'),
	('w_badge_v1', 'PLATINUM', '플래티넘', 15000, 4, 'platinum.webp', '2026-08-28T00:00:00+09:00'),
	('w_badge_v1', 'DIAMOND', '다이아몬드', 30000, 5, 'diamond.webp', '2026-08-28T00:00:00+09:00');
--> statement-breakpoint
CREATE TABLE "member_point_badge_awards" (
	"member_point_badge_award_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"badge_code" varchar(16) NOT NULL,
	"policy_version" varchar(32) NOT NULL,
	"threshold_snapshot" integer NOT NULL,
	"label_snapshot" varchar(32) NOT NULL,
	"source_ledger_entry_id" uuid,
	"award_source" varchar(32) NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_point_badge_awards_member_badge_unique" UNIQUE("member_id","badge_code"),
	CONSTRAINT "member_point_badge_awards_source_check" CHECK ("award_source" in ('LEDGER_ENTRY', 'MIGRATION_BACKFILL', 'POLICY_RECONCILIATION')),
	CONSTRAINT "member_point_badge_awards_threshold_check" CHECK ("threshold_snapshot" > 0)
);
--> statement-breakpoint
ALTER TABLE "member_point_badge_awards" ADD CONSTRAINT "member_point_badge_awards_member_id_point_accounts_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."point_accounts"("member_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_point_badge_awards" ADD CONSTRAINT "member_point_badge_awards_source_ledger_entry_id_point_ledger_entries_point_ledger_entry_id_fk" FOREIGN KEY ("source_ledger_entry_id") REFERENCES "public"."point_ledger_entries"("point_ledger_entry_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_point_badge_awards" ADD CONSTRAINT "member_point_badge_awards_policy_fk" FOREIGN KEY ("policy_version","badge_code") REFERENCES "public"."point_badge_policies"("policy_version","badge_code") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "member_point_badge_awards_member_awarded_idx" ON "member_point_badge_awards" USING btree ("member_id","awarded_at");
--> statement-breakpoint
WITH eligible AS (
	SELECT
		pa."member_id",
		pbp."badge_code",
		pbp."policy_version",
		pbp."minimum_lifetime_points",
		pbp."label"
	FROM "point_accounts" pa
	JOIN "point_badge_policies" pbp
		ON pbp."policy_version" = 'w_badge_v1'
		AND pbp."minimum_lifetime_points" <= pa."lifetime_earned"
)
INSERT INTO "member_point_badge_awards" (
	"member_id", "badge_code", "policy_version", "threshold_snapshot", "label_snapshot", "award_source"
)
SELECT
	"member_id", "badge_code", "policy_version", "minimum_lifetime_points", "label", 'MIGRATION_BACKFILL'
FROM eligible
ON CONFLICT ("member_id", "badge_code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "outbox_events" (
	"aggregate_type", "aggregate_id", "event_type", "schema_version", "payload"
)
SELECT
	'MEMBER_POINT_BADGE',
	award."member_point_badge_award_id"::text,
	'POINT_BADGE_AWARDED',
	1,
	jsonb_build_object(
		'memberId', award."member_id",
		'awardId', award."member_point_badge_award_id",
		'badgeCode', award."badge_code",
		'policyVersion', award."policy_version",
		'minimumLifetimePoints', award."threshold_snapshot"
	)
FROM "member_point_badge_awards" award
WHERE award."award_source" = 'MIGRATION_BACKFILL';
