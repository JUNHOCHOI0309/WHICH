CREATE TYPE "public"."comment_integrity_state" AS ENUM('NORMAL', 'REVIEW', 'REJECTED', 'INVALIDATED');--> statement-breakpoint
CREATE TYPE "public"."comment_publication_state" AS ENUM('PENDING_AUTOMOD', 'PENDING_HUMAN_REVIEW', 'PUBLISHED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."comment_thread_state" AS ENUM('OPEN', 'LOCKED');--> statement-breakpoint
CREATE TYPE "public"."comment_visibility" AS ENUM('VISIBLE', 'DEPRIORITIZED', 'COLLAPSED', 'HIDDEN', 'REMOVED_BY_AUTHOR', 'REMOVED_POLICY');--> statement-breakpoint
CREATE TABLE "comments" (
	"comment_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"issue_version" integer NOT NULL,
	"author_subject_id" uuid NOT NULL,
	"accepted_vote_id" uuid NOT NULL,
	"choice_snapshot" "choice_code" NOT NULL,
	"parent_comment_id" uuid,
	"thread_root_comment_id" uuid,
	"author_display_name_snapshot" varchar(40) NOT NULL,
	"body" text NOT NULL,
	"publication_state" "comment_publication_state" DEFAULT 'PENDING_AUTOMOD' NOT NULL,
	"visibility" "comment_visibility" DEFAULT 'VISIBLE' NOT NULL,
	"thread_state" "comment_thread_state" DEFAULT 'OPEN' NOT NULL,
	"integrity_state" "comment_integrity_state" DEFAULT 'NORMAL' NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comments_body_not_blank_check" CHECK (length(btrim("comments"."body")) > 0),
	CONSTRAINT "comments_positive_version_check" CHECK ("comments"."version" > 0),
	CONSTRAINT "comments_thread_shape_check" CHECK (("comments"."parent_comment_id" is null and "comments"."thread_root_comment_id" is null)
        or ("comments"."parent_comment_id" is not null and "comments"."thread_root_comment_id" is not null)),
	CONSTRAINT "comments_author_delete_shape_check" CHECK (("comments"."visibility" = 'REMOVED_BY_AUTHOR' and "comments"."deleted_at" is not null)
        or ("comments"."visibility" <> 'REMOVED_BY_AUTHOR'))
);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_subject_id_voter_subjects_subject_id_fk" FOREIGN KEY ("author_subject_id") REFERENCES "public"."voter_subjects"("subject_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_accepted_vote_id_votes_vote_id_fk" FOREIGN KEY ("accepted_vote_id") REFERENCES "public"."votes"("vote_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_issue_version_fk" FOREIGN KEY ("issue_id","issue_version") REFERENCES "public"."issue_versions"("issue_id","issue_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_fk" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."comments"("comment_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_thread_root_fk" FOREIGN KEY ("thread_root_comment_id") REFERENCES "public"."comments"("comment_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_public_issue_version_created_idx" ON "comments" USING btree ("issue_id","issue_version","created_at","comment_id");