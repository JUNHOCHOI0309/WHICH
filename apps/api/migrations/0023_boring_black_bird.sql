ALTER TABLE "members" ADD COLUMN "avatar_url" varchar(2048);--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "avatar_source_provider" "identity_provider";--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "avatar_object_key" varchar(512);--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "avatar_updated_at" timestamp with time zone;