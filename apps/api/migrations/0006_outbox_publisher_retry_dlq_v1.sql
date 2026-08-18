ALTER TABLE "outbox_events" ADD COLUMN "total_attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "requeue_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "claim_token" uuid;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "dead_lettered_at" timestamp with time zone;--> statement-breakpoint
UPDATE "outbox_events"
SET "published_at" = coalesce("published_at", "occurred_at")
WHERE "status" = 'PUBLISHED';--> statement-breakpoint
UPDATE "outbox_events"
SET "dead_lettered_at" = coalesce("dead_lettered_at", "available_at", "occurred_at")
WHERE "status" = 'FAILED';--> statement-breakpoint
CREATE INDEX "outbox_events_dead_letter_idx" ON "outbox_events" USING btree ("dead_lettered_at","occurred_at") WHERE "outbox_events"."status" = 'FAILED';--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_total_attempt_count_check" CHECK ("outbox_events"."total_attempt_count" >= 0);--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_requeue_count_check" CHECK ("outbox_events"."requeue_count" >= 0);--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_claim_check" CHECK (("outbox_events"."claim_token" is null and "outbox_events"."claimed_at" is null)
        or ("outbox_events"."status" = 'PENDING' and "outbox_events"."claim_token" is not null and "outbox_events"."claimed_at" is not null));--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_delivery_state_check" CHECK (("outbox_events"."status" = 'PENDING' and "outbox_events"."published_at" is null and "outbox_events"."dead_lettered_at" is null)
        or ("outbox_events"."status" = 'PUBLISHED' and "outbox_events"."published_at" is not null and "outbox_events"."dead_lettered_at" is null and "outbox_events"."claim_token" is null)
        or ("outbox_events"."status" = 'FAILED' and "outbox_events"."published_at" is null and "outbox_events"."dead_lettered_at" is not null and "outbox_events"."claim_token" is null));
