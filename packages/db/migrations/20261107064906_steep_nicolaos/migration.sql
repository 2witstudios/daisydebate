CREATE TABLE "necessary_evidence_erasure_requests" (
	"actor_id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"phase" text DEFAULT 'pending' NOT NULL,
	"propagated_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"last_claimed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"execution_worker_id" text,
	"execution_epoch" integer DEFAULT 0 NOT NULL,
	"lease_digest" text,
	"lease_expires_at" timestamp with time zone,
	CONSTRAINT "necessary_evidence_erasure_ids_check" CHECK ("actor_id" ~ '^[a-z0-9]{24}$' and "user_id" ~ '^[a-z0-9]{24}$' and ("execution_worker_id" is null or "execution_worker_id" ~ '^[a-z0-9]{24}$')),
	CONSTRAINT "necessary_evidence_erasure_phase_check" CHECK ("phase" in ('pending', 'propagated')),
	CONSTRAINT "necessary_evidence_erasure_propagation_check" CHECK (("phase"='propagated')=("propagated_at" is not null)),
	CONSTRAINT "necessary_evidence_erasure_execution_check" CHECK ("attempts">=0 and "execution_epoch">=0 and (("lease_digest" is null)=("lease_expires_at" is null)) and ("lease_digest" is null or "lease_digest" ~ '^[a-f0-9]{64}$'))
);
--> statement-breakpoint
ALTER TABLE "necessary_evidence" ADD COLUMN "original_speaker" jsonb;--> statement-breakpoint
CREATE INDEX "necessary_evidence_erasure_due_idx" ON "necessary_evidence_erasure_requests" ("next_attempt_at","actor_id");--> statement-breakpoint
ALTER TABLE "necessary_evidence" ADD CONSTRAINT "necessary_evidence_speaker_check" CHECK ("original_speaker" is null or (jsonb_typeof("original_speaker")='object' and octet_length("original_speaker"::text)<=512));