ALTER TABLE "necessary_evidence" ADD CONSTRAINT "necessary_evidence_authority_check" CHECK ("authority_id" is null or "authority_id" ~ '^[a-z0-9]{24}$');--> statement-breakpoint
ALTER TABLE "necessary_evidence" DROP CONSTRAINT "necessary_evidence_receipt_check", ADD CONSTRAINT "necessary_evidence_receipt_check" CHECK ((
    "received_at" is null and "expires_at" is null
  ) or (
    "authority_id" is not null and "received_at" is not null and "expires_at" is not null
    and "expires_at"="received_at"+interval '168 hours'
  ));