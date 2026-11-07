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
CREATE TABLE "necessary_evidence_round_fences" (
	"round_id" text PRIMARY KEY,
	"withdrawn_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "necessary_evidence" (
	"id" text PRIMARY KEY,
	"round_id" text,
	"original_round_id" text NOT NULL,
	"original_subject_actor_ids" text[],
	"original_speaker" jsonb,
	"session_id" text NOT NULL,
	"segment_id" text NOT NULL,
	"round_participant_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"capture_epoch" integer NOT NULL,
	"binding_digest" text NOT NULL,
	"state" text DEFAULT 'acquiring' NOT NULL,
	"retirement_reason" text,
	"reserved_bytes" integer NOT NULL,
	"authority_id" text,
	"received_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"payload_accepted_at" timestamp with time zone,
	"ciphertext" bytea,
	"nonce" bytea,
	"tag" bytea,
	"execution_worker_id" text,
	"execution_epoch" integer DEFAULT 0 NOT NULL,
	"lease_digest" text,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "necessary_evidence_original_speaker_is_object" CHECK (jsonb_typeof("original_speaker") = 'object'),
	CONSTRAINT "necessary_evidence_speaker_check" CHECK ("original_speaker" is null or (jsonb_typeof("original_speaker")='object' and octet_length("original_speaker"::text)<=512)),
	CONSTRAINT "necessary_evidence_subjects_check" CHECK ("original_subject_actor_ids" is null or (
      cardinality("original_subject_actor_ids") between 0 and 257 and (cardinality("original_subject_actor_ids")=0 or (
        array_ndims("original_subject_actor_ids")=1 and array_lower("original_subject_actor_ids",1)=1
        and array_position("original_subject_actor_ids",null) is null
        and array_to_string("original_subject_actor_ids",',') ~ '^[a-z0-9]{24}(,[a-z0-9]{24})*$'
      )))),
	CONSTRAINT "necessary_evidence_state_check" CHECK ("state" in ('acquiring', 'retained', 'retiring', 'retired')),
	CONSTRAINT "necessary_evidence_retirement_check" CHECK (("state" in ('retiring','retired')) = ("retirement_reason" is not null)),
	CONSTRAINT "necessary_evidence_reason_check" CHECK ("retirement_reason" is null or "retirement_reason" in ('settled','erased','expired','unreceived')),
	CONSTRAINT "necessary_evidence_bounds_check" CHECK ("capture_epoch">0 and "execution_epoch">=0 and "reserved_bytes" between 0 and 65536),
	CONSTRAINT "necessary_evidence_binding_check" CHECK ("binding_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "necessary_evidence_authority_check" CHECK ("authority_id" is null or "authority_id" ~ '^[a-z0-9]{24}$'),
	CONSTRAINT "necessary_evidence_receipt_check" CHECK ((
    "received_at" is null and "expires_at" is null
  ) or (
    "authority_id" is not null and "received_at" is not null and "expires_at" is not null
    and "expires_at"="received_at"+interval '168 hours'
  )),
	CONSTRAINT "necessary_evidence_acceptance_check" CHECK (("state"<>'retained' or "payload_accepted_at" is not null)
      and ("payload_accepted_at" is null or ("received_at" is not null
      and "payload_accepted_at">="received_at" and "payload_accepted_at"<"expires_at"))),
	CONSTRAINT "necessary_evidence_payload_check" CHECK ((
    "state"='retained' and "round_id" is not null and "authority_id" is not null
    and "ciphertext" is not null and octet_length("ciphertext") between 1 and 65536
    and "reserved_bytes"=octet_length("ciphertext")
    and "nonce" is not null and octet_length("nonce")=12
    and "tag" is not null and octet_length("tag")=16
  ) or (
    "state"<>'retained' and "ciphertext" is null and "nonce" is null and "tag" is null
    and (("state"='acquiring' and "reserved_bytes">0) or ("state" in ('retiring','retired') and "reserved_bytes"=0))
  )),
	CONSTRAINT "necessary_evidence_round_binding_check" CHECK ("round_id" is null or "round_id"="original_round_id"),
	CONSTRAINT "necessary_evidence_execution_worker_check" CHECK ("execution_worker_id" is null or "execution_worker_id" ~ '^[a-z0-9]{24}$'),
	CONSTRAINT "necessary_evidence_lease_check" CHECK (("lease_digest" is null) = ("lease_expires_at" is null))
);
--> statement-breakpoint
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
CREATE TABLE "transcription_recovery_enrollment_offers" (
	"evidence_id" text PRIMARY KEY,
	"last_offered_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcription_recovery_enrollment_progress" (
	"singleton" boolean PRIMARY KEY,
	"after_at" timestamp with time zone,
	"after_round_id" text,
	"until_at" timestamp with time zone,
	"until_round_id" text,
	"next_scan_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transcription_recovery_enrollment_progress_singleton" CHECK ("singleton"=true),
	CONSTRAINT "transcription_recovery_enrollment_progress_position_check" CHECK (("after_at" is null and "after_round_id" is null and "until_at" is null and "until_round_id" is null) or ("after_at" is not null and "after_round_id" ~ '^[a-z0-9]{24}$' and "after_round_id" is not null and "until_at" is not null and "until_round_id" ~ '^[a-z0-9]{24}$' and "until_round_id" is not null and ("after_at","after_round_id")<=("until_at","until_round_id")))
);
--> statement-breakpoint
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
	"enrolled_at" timestamp with time zone,
	"source_key" text NOT NULL,
	"start_offset_ms" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"first_sequence" bigint NOT NULL,
	"last_sequence" bigint NOT NULL,
	CONSTRAINT "transcription_recovery_sources_bounds_check" CHECK ("source_key" ~ '^[a-f0-9]{64}$' and "start_offset_ms">=0 and "duration_ms" between 10 and 30000 and "duration_ms"%10=0 and "first_sequence">=0 and "last_sequence">="first_sequence" and "last_sequence"<=9007199254740991 and ("last_sequence"::bigint-"first_sequence"+1)*10="duration_ms")
);
--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD COLUMN "generation_first_epoch" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD COLUMN "last_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD COLUMN "recovery_reason" text;--> statement-breakpoint
CREATE INDEX "necessary_evidence_erasure_due_idx" ON "necessary_evidence_erasure_requests" ("next_attempt_at","actor_id");--> statement-breakpoint
CREATE INDEX "necessary_evidence_round_idx" ON "necessary_evidence" ("round_id");--> statement-breakpoint
CREATE INDEX "necessary_evidence_original_round_idx" ON "necessary_evidence" ("original_round_id");--> statement-breakpoint
CREATE INDEX "necessary_evidence_subjects_idx" ON "necessary_evidence" USING gin ("original_subject_actor_ids");--> statement-breakpoint
CREATE INDEX "necessary_evidence_due_idx" ON "necessary_evidence" ("next_attempt_at","id");--> statement-breakpoint
CREATE INDEX "transcription_recovery_attempt_context_idx" ON "transcription_recovery_attempts" ("context_id");--> statement-breakpoint
CREATE INDEX "transcription_recovery_round_idx" ON "transcription_recovery_contexts" ("round_id");--> statement-breakpoint
CREATE INDEX "transcription_recovery_source_idx" ON "transcription_recovery_contexts" ("source_key","created_at");--> statement-breakpoint
CREATE INDEX "transcription_recovery_due_idx" ON "transcription_recovery_contexts" ("next_attempt_at","id");--> statement-breakpoint
CREATE INDEX "transcription_recovery_sources_context_idx" ON "transcription_recovery_sources" ("context_id");--> statement-breakpoint
CREATE INDEX "transcription_recovery_sources_run_idx" ON "transcription_recovery_sources" ("source_key","first_sequence");--> statement-breakpoint
ALTER TABLE "necessary_evidence_round_fences" ADD CONSTRAINT "necessary_evidence_round_fences_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "necessary_evidence" ADD CONSTRAINT "necessary_evidence_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "transcription_recovery_attempts" ADD CONSTRAINT "transcription_recovery_attempts_tPG35tQps7Dn_fkey" FOREIGN KEY ("context_id") REFERENCES "transcription_recovery_contexts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "transcription_recovery_enrollment_offers" ADD CONSTRAINT "transcription_recovery_enrollment_offers_TANcOjPPTs8n_fkey" FOREIGN KEY ("evidence_id") REFERENCES "necessary_evidence"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "transcription_recovery_contexts" ADD CONSTRAINT "transcription_recovery_contexts_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "transcription_recovery_sources" ADD CONSTRAINT "transcription_recovery_sources_qWM7zDIBADgT_fkey" FOREIGN KEY ("evidence_id") REFERENCES "necessary_evidence"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "transcription_recovery_sources" ADD CONSTRAINT "transcription_recovery_sources_ZWOD6kHx6KTB_fkey" FOREIGN KEY ("context_id") REFERENCES "transcription_recovery_contexts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD CONSTRAINT "round_judging_jobs_recovery_check" CHECK (("status" in ('recovering','blocked')) = ("recovery_reason" is not null)
        and ("recovery_reason" is null or "recovery_reason" in ('attempt_window', 'provider_refused', 'automatic_spend'))
        and ("status" <> 'recovering' or "retry_at" is not null));--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD CONSTRAINT "round_judging_jobs_generation_epoch_check" CHECK ("generation_first_epoch" >= 1 and "generation_first_epoch" <= "attempts" + 1);--> statement-breakpoint
ALTER TABLE "round_judging_jobs" DROP CONSTRAINT "round_judging_jobs_status_check", ADD CONSTRAINT "round_judging_jobs_status_check" CHECK ("status" in ('queued', 'leased', 'recovering', 'blocked', 'succeeded', 'failed'));
--> statement-breakpoint
-- Aggregate deletion must not erase custody cleanup discovery.
CREATE FUNCTION public.daisy_retire_round_evidence() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.necessary_evidence
  SET state='retiring',retirement_reason='erased',reserved_bytes=0,
      ciphertext=NULL,nonce=NULL,tag=NULL,lease_digest=NULL,lease_expires_at=NULL,
      next_attempt_at=clock_timestamp()
  WHERE round_id=OLD.id AND state<>'retired';
  RETURN OLD;
END;
$$;

--> statement-breakpoint
CREATE TRIGGER retire_round_evidence BEFORE DELETE ON public.rounds
FOR EACH ROW EXECUTE FUNCTION public.daisy_retire_round_evidence();

--> statement-breakpoint
-- Discovery stays read-only and never receives the encrypted payload columns.
GRANT SELECT (id,round_id,session_id,state,next_attempt_at,last_claimed_at)
ON public.necessary_evidence TO daisy_media_worker;

--> statement-breakpoint
-- Override inherited table-wide defaults; original provenance remains immutable to runtime writers.
REVOKE ALL PRIVILEGES ON transcription_recovery_contexts, transcription_recovery_sources FROM daisy_web;

--> statement-breakpoint
GRANT SELECT, INSERT ON transcription_recovery_contexts, transcription_recovery_sources TO daisy_web;

--> statement-breakpoint
GRANT UPDATE (duration_ms,last_sequence,units,status,last_source_at,next_attempt_at,last_claimed_at,claim_epoch,worker_id,lease_digest,lease_expires_at,attempts,model,policy_digest,blocked_reason,selected_revision,selected_digest,selected_at) ON transcription_recovery_contexts TO daisy_web;

--> statement-breakpoint
-- Original claim identity and conservative admission cannot be rewritten by runtime writers.
REVOKE ALL PRIVILEGES ON transcription_recovery_attempts FROM daisy_web;

--> statement-breakpoint
GRANT SELECT, INSERT ON transcription_recovery_attempts TO daisy_web;

--> statement-breakpoint
GRANT UPDATE (outcome,completed_at,candidate_digest,candidate_bytes) ON transcription_recovery_attempts TO daisy_web;

--> statement-breakpoint
INSERT INTO transcription_recovery_enrollment_progress(singleton) VALUES (true);

--> statement-breakpoint
REVOKE ALL PRIVILEGES ON transcription_recovery_enrollment_progress FROM daisy_web;

--> statement-breakpoint
GRANT SELECT ON transcription_recovery_enrollment_progress TO daisy_web;

--> statement-breakpoint
GRANT UPDATE (after_at,after_round_id,until_at,until_round_id,next_scan_at) ON transcription_recovery_enrollment_progress TO daisy_web;

--> statement-breakpoint
REVOKE ALL PRIVILEGES ON transcription_recovery_enrollment_offers FROM daisy_web;

--> statement-breakpoint
GRANT SELECT,INSERT ON transcription_recovery_enrollment_offers TO daisy_web;

--> statement-breakpoint
GRANT UPDATE (last_offered_at) ON transcription_recovery_enrollment_offers TO daisy_web;
