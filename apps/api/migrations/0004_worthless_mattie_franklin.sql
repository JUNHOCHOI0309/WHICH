CREATE TYPE "public"."comment_reaction_code" AS ENUM('HELPFUL');--> statement-breakpoint
CREATE TABLE "comment_reaction_attempts" (
	"comment_reaction_attempt_id" uuid PRIMARY KEY NOT NULL,
	"comment_id" uuid NOT NULL,
	"actor_subject_id" uuid NOT NULL,
	"reaction_code" "comment_reaction_code" DEFAULT 'HELPFUL' NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"response_snapshot" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "comment_reactions" (
	"comment_reaction_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"origin_subject_id" uuid NOT NULL,
	"reaction_code" "comment_reaction_code" DEFAULT 'HELPFUL' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"merged_into_reaction_id" uuid,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_reactions_comment_subject_code_unique" UNIQUE("comment_id","subject_id","reaction_code"),
	CONSTRAINT "comment_reactions_active_shape_check" CHECK (("comment_reactions"."active" = true and "comment_reactions"."deactivated_at" is null and "comment_reactions"."merged_into_reaction_id" is null)
        or ("comment_reactions"."active" = false and "comment_reactions"."deactivated_at" is not null)),
	CONSTRAINT "comment_reactions_not_self_merged_check" CHECK ("comment_reactions"."merged_into_reaction_id" is null or "comment_reactions"."merged_into_reaction_id" <> "comment_reactions"."comment_reaction_id")
);
--> statement-breakpoint
ALTER TABLE "comment_reaction_attempts" ADD CONSTRAINT "comment_reaction_attempts_comment_id_comments_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("comment_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reaction_attempts" ADD CONSTRAINT "comment_reaction_attempts_actor_subject_id_voter_subjects_subject_id_fk" FOREIGN KEY ("actor_subject_id") REFERENCES "public"."voter_subjects"("subject_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_comment_id_comments_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("comment_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_subject_id_voter_subjects_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."voter_subjects"("subject_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_origin_subject_id_voter_subjects_subject_id_fk" FOREIGN KEY ("origin_subject_id") REFERENCES "public"."voter_subjects"("subject_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_merged_into_fk" FOREIGN KEY ("merged_into_reaction_id") REFERENCES "public"."comment_reactions"("comment_reaction_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_reaction_attempts_actor_received_idx" ON "comment_reaction_attempts" USING btree ("actor_subject_id","received_at");--> statement-breakpoint
CREATE INDEX "comment_reactions_active_comment_code_idx" ON "comment_reactions" USING btree ("comment_id","reaction_code") WHERE "comment_reactions"."active" = true;--> statement-breakpoint
CREATE INDEX "comment_reactions_origin_subject_idx" ON "comment_reactions" USING btree ("origin_subject_id","created_at");