CREATE TABLE "beta_preapprovals" (
	"id" text PRIMARY KEY,
	"email" text NOT NULL UNIQUE,
	"revision" integer DEFAULT 1 NOT NULL,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "beta_preapprovals_email_normalized" CHECK ("email" = lower(btrim("email")) and length("email") between 3 and 320),
	CONSTRAINT "beta_preapprovals_revision_positive" CHECK ("revision" > 0),
	CONSTRAINT "beta_preapprovals_claim_check" CHECK (("claimed_by" is null) = ("claimed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "mail_intents" ADD COLUMN "preapproval_id" text;--> statement-breakpoint
CREATE INDEX "beta_preapprovals_claimed_idx" ON "beta_preapprovals" ("claimed_by");--> statement-breakpoint
ALTER TABLE "beta_preapprovals" ADD CONSTRAINT "beta_preapprovals_claimed_by_users_id_fkey" FOREIGN KEY ("claimed_by") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mail_intents" ADD CONSTRAINT "mail_intents_preapproval_id_beta_preapprovals_id_fkey" FOREIGN KEY ("preapproval_id") REFERENCES "beta_preapprovals"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "mail_intents" DROP CONSTRAINT "mail_intents_purpose_check", ADD CONSTRAINT "mail_intents_purpose_check" CHECK ("purpose" in ('beta-invitation', 'beta-approved', 'beta-requests-digest'));