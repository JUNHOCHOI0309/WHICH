CREATE TABLE "share_cards" (
	"share_card_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_version" varchar(32) DEFAULT 'result_share_v1' NOT NULL,
	"issue_id" uuid NOT NULL,
	"issue_version" integer NOT NULL,
	"tally_snapshot_id" uuid NOT NULL,
	"share_channel" varchar(16) NOT NULL,
	"shared_choice_code" "choice_code",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_cards_version_check" CHECK ("share_cards"."share_version" = 'result_share_v1'),
	CONSTRAINT "share_cards_channel_check" CHECK ("share_cards"."share_channel" in ('COPY', 'SYSTEM', 'X'))
);
--> statement-breakpoint
ALTER TABLE "analytics_events" DROP CONSTRAINT "analytics_events_type_check";--> statement-breakpoint
ALTER TABLE "analytics_events" ADD COLUMN "share_card_id" uuid;--> statement-breakpoint
ALTER TABLE "share_cards" ADD CONSTRAINT "share_cards_tally_snapshot_id_result_snapshots_tally_snapshot_id_fk" FOREIGN KEY ("tally_snapshot_id") REFERENCES "public"."result_snapshots"("tally_snapshot_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_cards" ADD CONSTRAINT "share_cards_issue_version_fk" FOREIGN KEY ("issue_id","issue_version") REFERENCES "public"."issue_versions"("issue_id","issue_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_cards" ADD CONSTRAINT "share_cards_shared_choice_fk" FOREIGN KEY ("issue_id","issue_version","shared_choice_code") REFERENCES "public"."issue_choices"("issue_id","issue_version","choice_code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_share_card_id_share_cards_share_card_id_fk" FOREIGN KEY ("share_card_id") REFERENCES "public"."share_cards"("share_card_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_type_check" CHECK ("analytics_events"."event_type" in ('ISSUE_VIEWABLE_IMPRESSION', 'VOTE_SUBMIT', 'RESULT_VIEW', 'NEXT_ISSUE_OPEN', 'NEXT_ISSUE_EXHAUSTED', 'INTEREST_PROMPT_VIEW', 'INTEREST_SELECTION_COMPLETE', 'INTEREST_PROMPT_SKIP', 'INTEREST_PROFILE_RESET', 'PERSONALIZED_FEED_VIEW', 'PERSONALIZED_ISSUE_OPEN', 'SHARE_OPEN', 'SHARE_CHOICE_TOGGLE', 'SHARE_COMPLETE'));