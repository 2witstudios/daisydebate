ALTER TABLE "beta_preapprovals" ADD COLUMN "last_invited_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "mail_intents_preapproval_idx" ON "mail_intents" ("preapproval_id");