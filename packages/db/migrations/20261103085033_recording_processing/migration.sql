CREATE TABLE "recording_captures" (
	"recording_id" text PRIMARY KEY,
	"round_id" text NOT NULL,
	"egress_id" text,
	"egress_started_at" timestamp with time zone,
	"egress_generation" integer DEFAULT 0 NOT NULL,
	"stage_credential_hash" text,
	"observer_revoked_at" timestamp with time zone,
	"revocation_failures" integer DEFAULT 0 NOT NULL,
	"reconcile_lease_until" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recording_captures_counters_check" CHECK ("egress_generation" >= 0 and "revocation_failures" >= 0)
);
--> statement-breakpoint
CREATE TABLE "recording_processing_jobs" (
	"recording_id" text PRIMARY KEY,
	"hold_prefix" text NOT NULL,
	"status" text NOT NULL,
	"state" jsonb NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone,
	"lease_owner" text,
	"lease_until" timestamp with time zone,
	"lease_epoch" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recording_jobs_status_check" CHECK ("status" in ('waiting', 'queued', 'built', 'failed', 'discarding', 'settled')),
	CONSTRAINT "recording_processing_jobs_state_is_object" CHECK (jsonb_typeof("state") = 'object'),
	CONSTRAINT "recording_jobs_state_status_check" CHECK ("state"->>'status' = "status"),
	CONSTRAINT "recording_jobs_counters_check" CHECK ("failures" >= 0 and "lease_epoch" >= 0),
	CONSTRAINT "recording_jobs_lease_check" CHECK (("lease_owner" is null) = ("lease_until" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "recording_captures_round_unique" ON "recording_captures" ("round_id");--> statement-breakpoint
CREATE INDEX "recording_jobs_claimable_idx" ON "recording_processing_jobs" ("due_at") WHERE "status" in ('queued', 'discarding');--> statement-breakpoint
CREATE INDEX "recording_jobs_answerable_idx" ON "recording_processing_jobs" ("updated_at") WHERE "status" <> 'settled';--> statement-breakpoint
ALTER TABLE "recording_captures" ADD CONSTRAINT "recording_captures_recording_id_recordings_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "recordings"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "recording_captures" ADD CONSTRAINT "recording_captures_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "recording_processing_jobs" ADD CONSTRAINT "recording_processing_jobs_recording_id_recordings_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "recordings"("id") ON DELETE RESTRICT;--> statement-breakpoint
-- daisy_recording_worker: the processing worker's only credential (REC-1.2).
-- It reads and updates its job table and touches nothing else, so it cannot read
-- a Recording or a Round, and cannot make a Recording ready. Explicit grants only.
-- No password here: staging and production provision the credential out of band.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'daisy_recording_worker') THEN
    CREATE ROLE daisy_recording_worker LOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO daisy_recording_worker;
--> statement-breakpoint
GRANT SELECT, UPDATE ON recording_processing_jobs TO daisy_recording_worker;
