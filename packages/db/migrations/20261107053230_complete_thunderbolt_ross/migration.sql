ALTER TABLE "necessary_evidence" ADD COLUMN "payload_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "necessary_evidence" ADD CONSTRAINT "necessary_evidence_acceptance_check" CHECK (("state"<>'retained' or "payload_accepted_at" is not null)
      and ("payload_accepted_at" is null or ("received_at" is not null
      and "payload_accepted_at">="received_at" and "payload_accepted_at"<"expires_at")));