ALTER TABLE "analytics_events" DROP CONSTRAINT "analytics_events_type_check";--> statement-breakpoint
ALTER TABLE "analytics_events" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD COLUMN "canonical_choice_id" uuid;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD COLUMN "shown_position" integer;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD COLUMN "media_mode" varchar(24);--> statement-breakpoint
ALTER TABLE "analytics_events" ADD COLUMN "media_load_outcome" varchar(16);--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_canonical_choice_fk" FOREIGN KEY ("issue_id","issue_version","canonical_choice_id") REFERENCES "public"."issue_choices"("issue_id","issue_version","choice_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_duration_check" CHECK ("analytics_events"."duration_ms" is null or ("analytics_events"."duration_ms" >= 0 and "analytics_events"."duration_ms" <= 1800000));--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_choice_position_check" CHECK (("analytics_events"."canonical_choice_id" is null and "analytics_events"."shown_position" is null)
        or ("analytics_events"."canonical_choice_id" is not null and "analytics_events"."shown_position" between 0 and 3));--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_media_check" CHECK (("analytics_events"."media_mode" is null or "analytics_events"."media_mode" in ('TEXT_ONLY', 'OPTION_IMAGES'))
        and ("analytics_events"."media_load_outcome" is null or "analytics_events"."media_load_outcome" in ('SUCCESS', 'FAILURE')));--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_type_check" CHECK ("analytics_events"."event_type" in ('ISSUE_VIEWABLE_IMPRESSION', 'VOTE_SUBMIT', 'RESULT_VIEW', 'NEXT_ISSUE_OPEN', 'NEXT_ISSUE_EXHAUSTED', 'INTEREST_PROMPT_VIEW', 'INTEREST_SELECTION_COMPLETE', 'INTEREST_PROMPT_SKIP', 'INTEREST_PROFILE_RESET', 'PERSONALIZED_FEED_VIEW', 'PERSONALIZED_ISSUE_OPEN', 'SHARE_OPEN', 'SHARE_CHOICE_TOGGLE', 'SHARE_COMPLETE', 'RESULT_DWELL_COMPLETE', 'COMMENT_COMPLETE', 'ISSUE_SKIP', 'ISSUE_HIDE', 'COMMENT_REPORT_COMPLETE', 'ISSUE_MEDIA_LOAD'));