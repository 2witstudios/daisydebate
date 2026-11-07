CREATE TABLE "transcription_recovery_contexts" (
	"id" text PRIMARY KEY,
	"round_id" text NOT NULL,
	"segment_id" text NOT NULL,
	"round_participant_id" text NOT NULL,
	"source_key" text NOT NULL,
	"start_offset_ms" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"first_sequence" bigint NOT NULL,
	"last_sequence" bigint NOT NULL,
	"units" integer NOT NULL,
	"status" text NOT NULL,
	"last_source_at" timestamp with time zone NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_claimed_at" timestamp with time zone,
	"claim_epoch" integer DEFAULT 0 NOT NULL,
	"worker_id" text,
	"lease_digest" text,
	"lease_expires_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"model" text,
	"policy_digest" text,
	"blocked_reason" text,
	"selected_revision" integer,
	"selected_digest" text,
	"selected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transcription_recovery_status_check" CHECK ("status" in ('collecting', 'queued', 'leased', 'retry', 'blocked', 'selected', 'erased', 'expired')),
	CONSTRAINT "transcription_recovery_source_check" CHECK ("source_key" ~ '^[a-f0-9]{64}$' and "start_offset_ms">=0 and "duration_ms" between 10 and 30000 and "duration_ms"%10=0 and "units" between 1 and 128 and "first_sequence">=0 and "last_sequence">="first_sequence" and "last_sequence"<=9007199254740991 and ("last_sequence"::bigint-"first_sequence"+1)*10="duration_ms"),
	CONSTRAINT "transcription_recovery_claim_check" CHECK ("claim_epoch">=0 and "attempts">=0 and (
    ("status"='leased' and "worker_id" is not null and "lease_digest" is not null and "lease_digest" ~ '^[a-f0-9]{64}$' and "lease_expires_at" is not null and "claim_epoch">0)
    or ("status"<>'leased' and "lease_digest" is null and "lease_expires_at" is null))),
	CONSTRAINT "transcription_recovery_model_check" CHECK (("model" is null and "policy_digest" is null and "attempts"=0) or ("model" is not null and octet_length("model") between 1 and 256 and "policy_digest" is not null and "policy_digest" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "transcription_recovery_blocked_check" CHECK (("status"='blocked')=("blocked_reason" is not null) and ("blocked_reason" is null or "blocked_reason" in ('provider', 'budget', 'quality', 'privacy', 'expired', 'unreceived'))),
	CONSTRAINT "transcription_recovery_selection_check" CHECK (("status"='selected' and "selected_revision" is not null and "selected_revision">=0 and "selected_digest" is not null and "selected_digest" ~ '^[a-f0-9]{64}$' and "selected_at" is not null) or ("status"<>'selected' and "selected_revision" is null and "selected_digest" is null and "selected_at" is null))
);
--> statement-breakpoint
CREATE TABLE "transcription_recovery_sources" (
	"evidence_id" text PRIMARY KEY,
	"context_id" text NOT NULL,
	"source_key" text NOT NULL,
	"start_offset_ms" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"first_sequence" bigint NOT NULL,
	"last_sequence" bigint NOT NULL,
	CONSTRAINT "transcription_recovery_sources_bounds_check" CHECK ("source_key" ~ '^[a-f0-9]{64}$' and "start_offset_ms">=0 and "duration_ms" between 10 and 30000 and "duration_ms"%10=0 and "first_sequence">=0 and "last_sequence">="first_sequence" and "last_sequence"<=9007199254740991 and ("last_sequence"::bigint-"first_sequence"+1)*10="duration_ms")
);
--> statement-breakpoint
CREATE INDEX "transcription_recovery_round_idx" ON "transcription_recovery_contexts" ("round_id");--> statement-breakpoint
CREATE INDEX "transcription_recovery_source_idx" ON "transcription_recovery_contexts" ("source_key","created_at");--> statement-breakpoint
CREATE INDEX "transcription_recovery_due_idx" ON "transcription_recovery_contexts" ("next_attempt_at","id");--> statement-breakpoint
CREATE INDEX "transcription_recovery_sources_context_idx" ON "transcription_recovery_sources" ("context_id");--> statement-breakpoint
CREATE INDEX "transcription_recovery_sources_run_idx" ON "transcription_recovery_sources" ("source_key","first_sequence");--> statement-breakpoint
ALTER TABLE "transcription_recovery_contexts" ADD CONSTRAINT "transcription_recovery_contexts_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "transcription_recovery_sources" ADD CONSTRAINT "transcription_recovery_sources_qWM7zDIBADgT_fkey" FOREIGN KEY ("evidence_id") REFERENCES "necessary_evidence"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "transcription_recovery_sources" ADD CONSTRAINT "transcription_recovery_sources_ZWOD6kHx6KTB_fkey" FOREIGN KEY ("context_id") REFERENCES "transcription_recovery_contexts"("id") ON DELETE CASCADE;--> statement-breakpoint
GRANT SELECT, INSERT ON transcription_recovery_contexts, transcription_recovery_sources TO daisy_web;
--> statement-breakpoint
GRANT UPDATE (duration_ms,last_sequence,units,status,last_source_at,next_attempt_at,last_claimed_at,claim_epoch,worker_id,lease_digest,lease_expires_at,attempts,model,policy_digest,blocked_reason,selected_revision,selected_digest,selected_at) ON transcription_recovery_contexts TO daisy_web;
