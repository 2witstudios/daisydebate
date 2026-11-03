ALTER TABLE "broadcasts" ADD COLUMN "release_skips" jsonb DEFAULT '{"clips":[]}' NOT NULL;--> statement-breakpoint
DROP INDEX "recording_jobs_claimable_idx";--> statement-breakpoint
CREATE INDEX "recording_jobs_claimable_idx" ON "recording_processing_jobs" ("due_at") WHERE "status" in ('queued', 'discarding', 'stripping');--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_release_skips_is_object" CHECK (jsonb_typeof("release_skips") = 'object');--> statement-breakpoint
ALTER TABLE "recording_processing_jobs" DROP CONSTRAINT "recording_jobs_status_check", ADD CONSTRAINT "recording_jobs_status_check" CHECK ("status" in ('waiting', 'queued', 'built', 'failed', 'discarding', 'stripping', 'stripped', 'settled'));--> statement-breakpoint
-- Whether a Recording will clear a Broadcast's hold, for the worker that would otherwise
-- clear it. The view runs as its owner, so this grants no Recording table (ADR 0099).
CREATE VIEW "broadcast_recording_claims" AS
  SELECT b.id AS broadcast_id
  FROM broadcasts b
  JOIN recordings r ON r.round_id = b.round_id;--> statement-breakpoint
GRANT SELECT ON "broadcast_recording_claims" TO daisy_broadcast_worker;
