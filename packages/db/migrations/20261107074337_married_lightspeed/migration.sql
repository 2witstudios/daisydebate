ALTER TABLE "round_judging_jobs" ADD COLUMN "recovery_reason" text;--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD CONSTRAINT "round_judging_jobs_recovery_check" CHECK (("status" in ('recovering','blocked')) = ("recovery_reason" is not null)
        and ("recovery_reason" is null or "recovery_reason" in ('attempt_window', 'provider_refused', 'automatic_spend'))
        and ("status" <> 'recovering' or "retry_at" is not null));--> statement-breakpoint
ALTER TABLE "round_judging_jobs" DROP CONSTRAINT "round_judging_jobs_status_check", ADD CONSTRAINT "round_judging_jobs_status_check" CHECK ("status" in ('queued', 'leased', 'recovering', 'blocked', 'succeeded', 'failed'));
--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD COLUMN "generation_first_epoch" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD CONSTRAINT "round_judging_jobs_generation_epoch_check" CHECK ("generation_first_epoch" >= 1 and "generation_first_epoch" <= "attempts" + 1);
--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD COLUMN "last_claimed_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE "necessary_evidence" (
	"id" text PRIMARY KEY,
	"round_id" text,
	"original_round_id" text NOT NULL,
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
	"ciphertext" bytea,
	"nonce" bytea,
	"tag" bytea,
	"execution_epoch" integer DEFAULT 0 NOT NULL,
	"lease_digest" text,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "necessary_evidence_state_check" CHECK ("state" in ('acquiring', 'retained', 'retiring', 'retired')),
	CONSTRAINT "necessary_evidence_retirement_check" CHECK (("state" in ('retiring','retired')) = ("retirement_reason" is not null)),
	CONSTRAINT "necessary_evidence_reason_check" CHECK ("retirement_reason" is null or "retirement_reason" in ('settled','erased','expired','unreceived')),
	CONSTRAINT "necessary_evidence_bounds_check" CHECK ("capture_epoch">0 and "execution_epoch">=0 and "reserved_bytes" between 0 and 65536),
	CONSTRAINT "necessary_evidence_binding_check" CHECK ("binding_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "necessary_evidence_receipt_check" CHECK ((
    "authority_id" is null and "received_at" is null and "expires_at" is null
  ) or (
    "authority_id" is not null and "received_at" is not null and "expires_at" is not null
    and "expires_at"="received_at"+interval '168 hours'
  )),
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
	CONSTRAINT "necessary_evidence_lease_check" CHECK (("lease_digest" is null) = ("lease_expires_at" is null))
);
--> statement-breakpoint
CREATE INDEX "necessary_evidence_round_idx" ON "necessary_evidence" ("round_id");--> statement-breakpoint
CREATE INDEX "necessary_evidence_due_idx" ON "necessary_evidence" ("next_attempt_at","id");--> statement-breakpoint
ALTER TABLE "necessary_evidence" ADD CONSTRAINT "necessary_evidence_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE SET NULL;--> statement-breakpoint
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
ALTER TABLE "necessary_evidence" ADD COLUMN "original_subject_actor_ids" text[];--> statement-breakpoint
CREATE INDEX "necessary_evidence_subjects_idx" ON "necessary_evidence" USING gin ("original_subject_actor_ids");--> statement-breakpoint
ALTER TABLE "necessary_evidence" ADD CONSTRAINT "necessary_evidence_subjects_check" CHECK ("original_subject_actor_ids" is null or (
      cardinality("original_subject_actor_ids") between 0 and 257 and (cardinality("original_subject_actor_ids")=0 or (
        array_ndims("original_subject_actor_ids")=1 and array_lower("original_subject_actor_ids",1)=1
        and array_position("original_subject_actor_ids",null) is null
        and array_to_string("original_subject_actor_ids",',') ~ '^[a-z0-9]{24}(,[a-z0-9]{24})*$'
      ))));
--> statement-breakpoint
CREATE TABLE "necessary_evidence_round_fences" (
	"round_id" text PRIMARY KEY,
	"withdrawn_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "necessary_evidence" ADD COLUMN "execution_worker_id" text;--> statement-breakpoint
CREATE INDEX "necessary_evidence_original_round_idx" ON "necessary_evidence" ("original_round_id");--> statement-breakpoint
ALTER TABLE "necessary_evidence_round_fences" ADD CONSTRAINT "necessary_evidence_round_fences_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "necessary_evidence" ADD CONSTRAINT "necessary_evidence_execution_worker_check" CHECK ("execution_worker_id" is null or "execution_worker_id" ~ '^[a-z0-9]{24}$');
--> statement-breakpoint
ALTER TABLE "necessary_evidence" ADD COLUMN "payload_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "necessary_evidence" ADD CONSTRAINT "necessary_evidence_acceptance_check" CHECK (("state"<>'retained' or "payload_accepted_at" is not null)
      and ("payload_accepted_at" is null or ("received_at" is not null
      and "payload_accepted_at">="received_at" and "payload_accepted_at"<"expires_at")));
--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE "necessary_evidence" ADD CONSTRAINT "necessary_evidence_authority_check" CHECK ("authority_id" is null or "authority_id" ~ '^[a-z0-9]{24}$');--> statement-breakpoint
ALTER TABLE "necessary_evidence" DROP CONSTRAINT "necessary_evidence_receipt_check", ADD CONSTRAINT "necessary_evidence_receipt_check" CHECK ((
    "received_at" is null and "expires_at" is null
  ) or (
    "authority_id" is not null and "received_at" is not null and "expires_at" is not null
    and "expires_at"="received_at"+interval '168 hours'
  ));
