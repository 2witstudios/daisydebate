ALTER TABLE "transcript_segments" ADD COLUMN "partial_reasons" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
-- Rows sealed before reasons existed have none, and their seal is immutable.
-- Only this one-time backfill may pass the guard.
ALTER TABLE "transcript_segments" DISABLE TRIGGER "transcript_segments_seal_immutable";--> statement-breakpoint
UPDATE "transcript_segments" SET "partial_reasons" = '{never-sealed}' WHERE "state" = 'partial';--> statement-breakpoint
ALTER TABLE "transcript_segments" ENABLE TRIGGER "transcript_segments_seal_immutable";
--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_partial_reasons_check" CHECK (("state" = 'partial') = (cardinality("partial_reasons") > 0));--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_partial_reasons_known_check" CHECK ("partial_reasons" <@ array['session-interrupted', 'frames-lost', 'other-worker-evidence', 'chunks-uncounted', 'invalid-history', 'no-authority-window', 'coverage-gap', 'never-sealed']::text[]);