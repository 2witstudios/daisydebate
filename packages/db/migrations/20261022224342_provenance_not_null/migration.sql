ALTER TABLE "ballots" DROP CONSTRAINT "ballots_freeze_pair_check";--> statement-breakpoint
ALTER TABLE "ballots" ALTER COLUMN "round_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ballots" ALTER COLUMN "freeze_revision" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_reservations" ALTER COLUMN "reserved_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_freeze_revision_positive" CHECK ("freeze_revision" > 0);--> statement-breakpoint
ALTER TABLE "usage_reservations" DROP CONSTRAINT "usage_reservations_admission_check", ADD CONSTRAINT "usage_reservations_admission_check" CHECK ("counted_at" is null or "counted_at" >= "reserved_at");