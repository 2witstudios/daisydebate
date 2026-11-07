CREATE TABLE "transcription_recovery_attempts" (
	"context_id" text,
	"claim_epoch" integer,
	"ordinal" integer NOT NULL,
	"outcome" text NOT NULL,
	"admitted_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"candidate_digest" text,
	"candidate_bytes" integer,
	CONSTRAINT "transcription_recovery_attempts_pkey" PRIMARY KEY("context_id","claim_epoch"),
	CONSTRAINT "transcription_recovery_attempt_ordinal_unique" UNIQUE("context_id","ordinal"),
	CONSTRAINT "transcription_recovery_attempt_bounds_check" CHECK ("claim_epoch">0 and "ordinal" between 1 and 64),
	CONSTRAINT "transcription_recovery_attempt_outcome_check" CHECK ("outcome" in ('admitted', 'candidate', 'provider_failure', 'quality_review', 'uncertain')),
	CONSTRAINT "transcription_recovery_attempt_candidate_check" CHECK (("candidate_digest" is null and "candidate_bytes" is null and "outcome" not in ('candidate','quality_review')) or ("candidate_digest" is not null and "candidate_digest" ~ '^[a-f0-9]{64}$' and "candidate_bytes" is not null and "candidate_bytes" between 0 and 65536 and "outcome" in ('candidate','quality_review','uncertain'))),
	CONSTRAINT "transcription_recovery_attempt_time_check" CHECK (("outcome"='admitted' and "completed_at" is null) or ("outcome"<>'admitted' and "completed_at" is not null and "completed_at">="admitted_at"))
);
--> statement-breakpoint
CREATE INDEX "transcription_recovery_attempt_context_idx" ON "transcription_recovery_attempts" ("context_id");--> statement-breakpoint
ALTER TABLE "transcription_recovery_attempts" ADD CONSTRAINT "transcription_recovery_attempts_tPG35tQps7Dn_fkey" FOREIGN KEY ("context_id") REFERENCES "transcription_recovery_contexts"("id") ON DELETE CASCADE;
--> statement-breakpoint
-- Original claim identity and conservative admission cannot be rewritten by runtime writers.
REVOKE ALL PRIVILEGES ON transcription_recovery_attempts FROM daisy_web;
--> statement-breakpoint
GRANT SELECT, INSERT ON transcription_recovery_attempts TO daisy_web;
--> statement-breakpoint
GRANT UPDATE (outcome,completed_at,candidate_digest,candidate_bytes) ON transcription_recovery_attempts TO daisy_web;
