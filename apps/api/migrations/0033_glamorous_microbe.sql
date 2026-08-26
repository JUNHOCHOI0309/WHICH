CREATE TABLE "mobile_auth_exchange_tickets" (
	"mobile_auth_exchange_ticket_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"ticket_hash" varchar(64) NOT NULL,
	"code_challenge" varchar(43) NOT NULL,
	"state_hash" varchar(64) NOT NULL,
	"nonce_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mobile_auth_exchange_tickets_hash_unique" UNIQUE("ticket_hash"),
	CONSTRAINT "mobile_auth_exchange_tickets_challenge_check" CHECK (length("mobile_auth_exchange_tickets"."code_challenge") = 43),
	CONSTRAINT "mobile_auth_exchange_tickets_expiry_check" CHECK ("mobile_auth_exchange_tickets"."expires_at" > "mobile_auth_exchange_tickets"."created_at")
);
--> statement-breakpoint
ALTER TABLE "mobile_auth_exchange_tickets" ADD CONSTRAINT "mobile_auth_exchange_tickets_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mobile_auth_exchange_tickets_member_created_idx" ON "mobile_auth_exchange_tickets" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "mobile_auth_exchange_tickets_active_expiry_idx" ON "mobile_auth_exchange_tickets" USING btree ("expires_at") WHERE "mobile_auth_exchange_tickets"."consumed_at" is null;