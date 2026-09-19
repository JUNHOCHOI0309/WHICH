CREATE TABLE "radar_event_source_references" (
	"reference_id" uuid PRIMARY KEY NOT NULL,
	"reference_key" varchar(64) NOT NULL,
	"event_id" uuid NOT NULL,
	"source_code" varchar(32) NOT NULL,
	"source_item_id" varchar(500) NOT NULL,
	"title" varchar(500) NOT NULL,
	"normalized_title" varchar(500) NOT NULL,
	"language_code" varchar(35) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "radar_event_source_references_key_unique" UNIQUE("reference_key"),
	CONSTRAINT "radar_event_source_item_unique" UNIQUE("source_code","source_item_id"),
	CONSTRAINT "radar_event_source_references_hash_check" CHECK ("radar_event_source_references"."reference_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "radar_event_source_references_text_check" CHECK (length(trim("radar_event_source_references"."source_item_id")) > 0 and length(trim("radar_event_source_references"."title")) > 0 and length(trim("radar_event_source_references"."normalized_title")) > 0 and length(trim("radar_event_source_references"."language_code")) > 0)
);
--> statement-breakpoint
CREATE TABLE "radar_resolution_actions" (
	"action_id" uuid PRIMARY KEY NOT NULL,
	"sequence" serial NOT NULL,
	"entity_type" varchar(16) NOT NULL,
	"action" varchar(16) NOT NULL,
	"subject_id" uuid NOT NULL,
	"target_ids" uuid[] NOT NULL,
	"reverts_action_id" uuid,
	"reason" varchar(2000) NOT NULL,
	"actor" varchar(200) NOT NULL,
	"resolver_version" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "radar_resolution_actions_sequence_unique" UNIQUE("sequence"),
	CONSTRAINT "radar_resolution_actions_type_check" CHECK ("radar_resolution_actions"."entity_type" in ('TOPIC','EVENT')),
	CONSTRAINT "radar_resolution_actions_action_check" CHECK (("radar_resolution_actions"."action" = 'MERGE' and cardinality("radar_resolution_actions"."target_ids") = 1 and "radar_resolution_actions"."reverts_action_id" is null)
        or ("radar_resolution_actions"."action" = 'SPLIT' and cardinality("radar_resolution_actions"."target_ids") >= 2 and "radar_resolution_actions"."reverts_action_id" is null)
        or ("radar_resolution_actions"."action" = 'REVERT' and cardinality("radar_resolution_actions"."target_ids") = 0 and "radar_resolution_actions"."reverts_action_id" is not null)),
	CONSTRAINT "radar_resolution_actions_subject_check" CHECK (array_position("radar_resolution_actions"."target_ids", "radar_resolution_actions"."subject_id") is null),
	CONSTRAINT "radar_resolution_actions_text_check" CHECK (length(trim("radar_resolution_actions"."reason")) > 0 and length(trim("radar_resolution_actions"."actor")) > 0 and length(trim("radar_resolution_actions"."resolver_version")) > 0)
);
--> statement-breakpoint
CREATE TABLE "radar_topic_aliases" (
	"alias_id" uuid PRIMARY KEY NOT NULL,
	"alias_key" varchar(64) NOT NULL,
	"topic_id" uuid NOT NULL,
	"alias" varchar(500) NOT NULL,
	"normalized_alias" varchar(500) NOT NULL,
	"language_code" varchar(35) NOT NULL,
	"source_code" varchar(32),
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"status" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "radar_topic_aliases_key_unique" UNIQUE("alias_key"),
	CONSTRAINT "radar_topic_aliases_hash_check" CHECK ("radar_topic_aliases"."alias_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "radar_topic_aliases_text_check" CHECK (length(trim("radar_topic_aliases"."alias")) > 0 and length(trim("radar_topic_aliases"."normalized_alias")) > 0 and length(trim("radar_topic_aliases"."language_code")) > 0),
	CONSTRAINT "radar_topic_aliases_status_check" CHECK ("radar_topic_aliases"."status" in ('CANDIDATE','VERIFIED','REJECTED')),
	CONSTRAINT "radar_topic_aliases_validity_check" CHECK ("radar_topic_aliases"."valid_from" is null or "radar_topic_aliases"."valid_until" is null or "radar_topic_aliases"."valid_until" > "radar_topic_aliases"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "radar_event_source_references" ADD CONSTRAINT "radar_event_source_references_event_id_radar_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."radar_events"("event_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_event_source_references" ADD CONSTRAINT "radar_event_source_references_source_code_radar_sources_source_code_fk" FOREIGN KEY ("source_code") REFERENCES "public"."radar_sources"("source_code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_resolution_actions" ADD CONSTRAINT "radar_resolution_actions_reverts_fk" FOREIGN KEY ("reverts_action_id") REFERENCES "public"."radar_resolution_actions"("action_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_topic_aliases" ADD CONSTRAINT "radar_topic_aliases_topic_id_radar_topics_topic_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."radar_topics"("topic_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_topic_aliases" ADD CONSTRAINT "radar_topic_aliases_source_code_radar_sources_source_code_fk" FOREIGN KEY ("source_code") REFERENCES "public"."radar_sources"("source_code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "radar_event_source_references_lookup_idx" ON "radar_event_source_references" USING btree ("normalized_title","language_code","source_code");--> statement-breakpoint
CREATE INDEX "radar_event_source_references_event_idx" ON "radar_event_source_references" USING btree ("event_id","observed_at");--> statement-breakpoint
CREATE INDEX "radar_resolution_actions_subject_idx" ON "radar_resolution_actions" USING btree ("entity_type","subject_id","created_at");--> statement-breakpoint
CREATE INDEX "radar_resolution_actions_revert_idx" ON "radar_resolution_actions" USING btree ("reverts_action_id");--> statement-breakpoint
CREATE INDEX "radar_topic_aliases_lookup_idx" ON "radar_topic_aliases" USING btree ("normalized_alias","language_code","source_code","status");--> statement-breakpoint
CREATE INDEX "radar_topic_aliases_topic_idx" ON "radar_topic_aliases" USING btree ("topic_id","created_at");