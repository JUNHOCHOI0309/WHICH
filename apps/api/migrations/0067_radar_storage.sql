CREATE TABLE "radar_event_observations" (
	"event_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	CONSTRAINT "radar_event_observations_event_id_observation_id_pk" PRIMARY KEY("event_id","observation_id")
);
--> statement-breakpoint
CREATE TABLE "radar_event_topics" (
	"event_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	CONSTRAINT "radar_event_topics_event_id_topic_id_pk" PRIMARY KEY("event_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE "radar_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"title" varchar(500) NOT NULL,
	"occurred_at" timestamp with time zone,
	"time_precision" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "radar_events_title_check" CHECK (length(trim("radar_events"."title")) > 0),
	CONSTRAINT "radar_events_time_check" CHECK (("radar_events"."time_precision" = 'UNKNOWN' and "radar_events"."occurred_at" is null) or ("radar_events"."time_precision" in ('EXACT','DAY') and "radar_events"."occurred_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "radar_evidence" (
	"evidence_id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"source_code" varchar(32) NOT NULL,
	"source_url" varchar(8192) NOT NULL,
	"claim" varchar(500) NOT NULL,
	"published_at" timestamp with time zone,
	"observed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" varchar(16) NOT NULL,
	CONSTRAINT "radar_evidence_claim_check" CHECK (length(trim("radar_evidence"."claim")) > 0),
	CONSTRAINT "radar_evidence_url_check" CHECK ("radar_evidence"."source_url" ~ '^https://[^/@[:space:]]+([/?#]|$)'),
	CONSTRAINT "radar_evidence_status_check" CHECK ("radar_evidence"."status" in ('SUPPORTED','PARTIAL','CONFLICTED','UNKNOWN','RETRACTED')),
	CONSTRAINT "radar_evidence_expiry_check" CHECK ("radar_evidence"."expires_at" > "radar_evidence"."observed_at" and "radar_evidence"."expires_at" <= "radar_evidence"."observed_at" + interval '24 hours')
);
--> statement-breakpoint
CREATE TABLE "radar_issue_links" (
	"event_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"issue_version" integer NOT NULL,
	CONSTRAINT "radar_issue_links_event_id_issue_id_issue_version_pk" PRIMARY KEY("event_id","issue_id","issue_version")
);
--> statement-breakpoint
CREATE TABLE "radar_observation_revisions" (
	"observation_id" uuid NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "radar_observation_revisions_observation_id_content_hash_pk" PRIMARY KEY("observation_id","content_hash"),
	CONSTRAINT "radar_revisions_hash_check" CHECK ("radar_observation_revisions"."content_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "radar_observations" (
	"observation_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"observation_key" varchar(64) NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"source_code" varchar(32) NOT NULL,
	"source_item_id" varchar(500) NOT NULL,
	"source_url" varchar(8192) NOT NULL,
	"title" varchar(500) NOT NULL,
	"metric_name" varchar(500) NOT NULL,
	"country_code" varchar(2) NOT NULL,
	"query_key" varchar(500) NOT NULL,
	"dimensions_key" varchar(500) NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"granularity" varchar(16) NOT NULL,
	"sampled_at" timestamp with time zone NOT NULL,
	"source_updated_at" timestamp with time zone,
	"metric_kind" varchar(24) NOT NULL,
	"metric_value" double precision,
	"comparison_key" varchar(500),
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "radar_observations_key_unique" UNIQUE("observation_key"),
	CONSTRAINT "radar_observations_hash_check" CHECK ("radar_observations"."observation_key" ~ '^[0-9a-f]{64}$' and "radar_observations"."content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "radar_observations_text_check" CHECK (length(trim("radar_observations"."title")) > 0 and length(trim("radar_observations"."source_item_id")) > 0 and length(trim("radar_observations"."metric_name")) > 0 and length(trim("radar_observations"."query_key")) > 0 and length(trim("radar_observations"."dimensions_key")) > 0),
	CONSTRAINT "radar_observations_url_check" CHECK ("radar_observations"."source_url" ~ '^https://[^/@[:space:]]+([/?#]|$)'),
	CONSTRAINT "radar_observations_country_check" CHECK ("radar_observations"."country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "radar_observations_window_check" CHECK ("radar_observations"."window_end" >= "radar_observations"."window_start" and "radar_observations"."granularity" in ('SNAPSHOT','HOUR','DAY','WEEK','MONTH')),
	CONSTRAINT "radar_observations_metric_check" CHECK (
    ("radar_observations"."metric_kind" in ('COUNT','LOWER_BOUND') and "radar_observations"."comparison_key" is null and
      ("radar_observations"."metric_value" is null or ("radar_observations"."metric_value" >= 0 and "radar_observations"."metric_value" <= 9007199254740991 and "radar_observations"."metric_value" = floor("radar_observations"."metric_value")))) or
    ("radar_observations"."metric_kind" = 'RANK' and "radar_observations"."comparison_key" is not null and length(trim("radar_observations"."comparison_key")) > 0 and
      ("radar_observations"."metric_value" is null or ("radar_observations"."metric_value" >= 1 and "radar_observations"."metric_value" <= 9007199254740991 and "radar_observations"."metric_value" = floor("radar_observations"."metric_value")))) or
    ("radar_observations"."metric_kind" = 'RELATIVE_INDEX' and "radar_observations"."comparison_key" is not null and length(trim("radar_observations"."comparison_key")) > 0 and
      ("radar_observations"."metric_value" is null or ("radar_observations"."metric_value" >= 0 and "radar_observations"."metric_value" <= 100)))),
	CONSTRAINT "radar_observations_expiry_check" CHECK ("radar_observations"."expires_at" > "radar_observations"."fetched_at" and "radar_observations"."expires_at" <= "radar_observations"."fetched_at" + interval '24 hours')
);
--> statement-breakpoint
CREATE TABLE "radar_sources" (
	"source_code" varchar(32) PRIMARY KEY NOT NULL,
	CONSTRAINT "radar_sources_code_check" CHECK ("radar_sources"."source_code" in ('GOOGLE_TRENDING_RSS', 'NAVER_SEARCH', 'NAVER_DATALAB', 'YOUTUBE_DATA_API'))
);
--> statement-breakpoint
CREATE TABLE "radar_topics" (
	"topic_id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "radar_topics_name_check" CHECK (length(trim("radar_topics"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "radar_event_observations" ADD CONSTRAINT "radar_event_observations_event_id_radar_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."radar_events"("event_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_event_observations" ADD CONSTRAINT "radar_event_observations_observation_id_radar_observations_observation_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."radar_observations"("observation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_event_topics" ADD CONSTRAINT "radar_event_topics_event_id_radar_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."radar_events"("event_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_event_topics" ADD CONSTRAINT "radar_event_topics_topic_id_radar_topics_topic_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."radar_topics"("topic_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_evidence" ADD CONSTRAINT "radar_evidence_event_id_radar_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."radar_events"("event_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_evidence" ADD CONSTRAINT "radar_evidence_source_code_radar_sources_source_code_fk" FOREIGN KEY ("source_code") REFERENCES "public"."radar_sources"("source_code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_issue_links" ADD CONSTRAINT "radar_issue_links_event_id_radar_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."radar_events"("event_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_issue_links" ADD CONSTRAINT "radar_issue_links_version_fk" FOREIGN KEY ("issue_id","issue_version") REFERENCES "public"."issue_versions"("issue_id","issue_version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_observation_revisions" ADD CONSTRAINT "radar_observation_revisions_observation_id_radar_observations_observation_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."radar_observations"("observation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_observations" ADD CONSTRAINT "radar_observations_source_code_radar_sources_source_code_fk" FOREIGN KEY ("source_code") REFERENCES "public"."radar_sources"("source_code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "radar_event_observations_observation_idx" ON "radar_event_observations" USING btree ("observation_id");--> statement-breakpoint
CREATE INDEX "radar_event_topics_topic_idx" ON "radar_event_topics" USING btree ("topic_id","event_id");--> statement-breakpoint
CREATE INDEX "radar_events_occurred_idx" ON "radar_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "radar_evidence_event_time_idx" ON "radar_evidence" USING btree ("event_id","observed_at");--> statement-breakpoint
CREATE INDEX "radar_evidence_source_time_idx" ON "radar_evidence" USING btree ("source_code","observed_at");--> statement-breakpoint
CREATE INDEX "radar_evidence_expiry_idx" ON "radar_evidence" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "radar_issue_links_issue_idx" ON "radar_issue_links" USING btree ("issue_id","issue_version");--> statement-breakpoint
CREATE INDEX "radar_observations_source_sample_idx" ON "radar_observations" USING btree ("source_code","sampled_at");--> statement-breakpoint
CREATE INDEX "radar_observations_source_window_idx" ON "radar_observations" USING btree ("source_code","window_start","window_end");--> statement-breakpoint
CREATE INDEX "radar_observations_item_idx" ON "radar_observations" USING btree ("source_code","source_item_id");--> statement-breakpoint
CREATE INDEX "radar_observations_expiry_idx" ON "radar_observations" USING btree ("expires_at");
--> statement-breakpoint
-- Identity catalog only; R02 activation/rights remain disabled and separate.
INSERT INTO "radar_sources" ("source_code") VALUES
  ('GOOGLE_TRENDING_RSS'), ('NAVER_SEARCH'), ('NAVER_DATALAB'), ('YOUTUBE_DATA_API')
ON CONFLICT DO NOTHING;
