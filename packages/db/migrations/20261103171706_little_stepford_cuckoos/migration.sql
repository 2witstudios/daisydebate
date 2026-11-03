ALTER TABLE "broadcasts" ADD COLUMN "media_withheld" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "recording_processing_jobs" DROP COLUMN "failures";--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_withheld_check" CHECK (not "media_withheld" or "stopped_at" is not null);--> statement-breakpoint
ALTER TABLE "recording_processing_jobs" DROP CONSTRAINT IF EXISTS "recording_jobs_counters_check", ADD CONSTRAINT "recording_jobs_counters_check" CHECK ("lease_epoch" >= 0);