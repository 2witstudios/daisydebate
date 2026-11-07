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
