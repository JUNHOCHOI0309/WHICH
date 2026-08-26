ALTER TABLE "point_event_receipts" DROP CONSTRAINT "point_event_receipts_outcome_check";--> statement-breakpoint
ALTER TABLE "point_accounts" ADD COLUMN "restricted_debt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "point_accounts" ADD CONSTRAINT "point_accounts_restricted_debt_check" CHECK ("point_accounts"."restricted_debt" >= 0);--> statement-breakpoint
ALTER TABLE "point_event_receipts" ADD CONSTRAINT "point_event_receipts_outcome_check" CHECK ("point_event_receipts"."outcome" in ('AWARDED', 'REVERSED', 'DUPLICATE', 'CAP_REACHED', 'INELIGIBLE', 'DISABLED'));