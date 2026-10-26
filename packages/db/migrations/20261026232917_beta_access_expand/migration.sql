CREATE TABLE "account_access_events" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"command_id" text,
	"from_state" text,
	"to_state" text NOT NULL,
	"revision" integer NOT NULL,
	"principal" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_access_events_from_check" CHECK ("from_state" is null or "from_state" in ('pending', 'approved', 'revoked')),
	CONSTRAINT "account_access_events_to_check" CHECK ("to_state" in ('pending', 'approved', 'revoked')),
	CONSTRAINT "account_access_events_principal_check" CHECK ("principal" ~ '^(signup|migration:[a-z0-9_]+|operator:[a-z0-9-]+/[a-z0-9]{24})$')
);
--> statement-breakpoint
CREATE TABLE "account_beta_access" (
	"user_id" text PRIMARY KEY,
	"state" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"provenance" text NOT NULL,
	CONSTRAINT "account_beta_access_state_check" CHECK ("state" in ('pending', 'approved', 'revoked')),
	CONSTRAINT "account_beta_access_provenance_check" CHECK ("provenance" in ('signup', 'grandfathered')),
	CONSTRAINT "account_beta_access_revision_positive" CHECK ("revision" > 0),
	CONSTRAINT "account_beta_access_decided_check" CHECK (("state" = 'pending') = ("decided_at" is null))
);
--> statement-breakpoint
CREATE TABLE "operator_command_receipts" (
	"command_id" text PRIMARY KEY,
	"service_id" text NOT NULL,
	"operator_ref" text NOT NULL,
	"action" text NOT NULL,
	"target_user_id" text NOT NULL,
	"request_digest" text NOT NULL,
	"result" jsonb NOT NULL,
	"admin_audit_head" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_command_receipts_digest_check" CHECK ("request_digest" ~ '^[0-9a-f]{64}$' and "admin_audit_head" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "operator_command_receipts_result_is_object" CHECK (jsonb_typeof("result") = 'object')
);
--> statement-breakpoint
CREATE TABLE "mail_intents" (
	"id" text PRIMARY KEY,
	"purpose" text NOT NULL,
	"recipient_user_id" text,
	"dedupe_key" text NOT NULL UNIQUE,
	"state" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token_digest" text,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "mail_intents_purpose_check" CHECK ("purpose" in ('beta-approved', 'beta-requests-digest')),
	CONSTRAINT "mail_intents_state_check" CHECK ("state" in ('queued', 'leased', 'sent', 'failed', 'cancelled')),
	CONSTRAINT "mail_intents_recipient_check" CHECK (("purpose" = 'beta-approved') = ("recipient_user_id" is not null)),
	CONSTRAINT "mail_intents_attempts_check" CHECK ("attempts" >= 0),
	CONSTRAINT "mail_intents_lease_check" CHECK (("state" = 'leased') = ("lease_token_digest" is not null and "lease_expires_at" is not null) and ("lease_token_digest" is null or "lease_token_digest" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "mail_intents_completed_check" CHECK (("state" in ('sent', 'failed', 'cancelled')) = ("completed_at" is not null)),
	CONSTRAINT "mail_intents_error_check" CHECK ("last_error_code" is null or "last_error_code" in ('delivery', 'suppressed', 'recipient-gone', 'unconfigured', 'not-owed'))
);
--> statement-breakpoint
CREATE INDEX "account_access_events_user_idx" ON "account_access_events" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "account_beta_access_listing_idx" ON "account_beta_access" ("state","requested_at","user_id");--> statement-breakpoint
CREATE INDEX "operator_command_receipts_created_idx" ON "operator_command_receipts" ("created_at");--> statement-breakpoint
CREATE INDEX "mail_intents_due_idx" ON "mail_intents" ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "mail_intents_recipient_idx" ON "mail_intents" ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "mail_intents_completed_idx" ON "mail_intents" ("completed_at");--> statement-breakpoint
ALTER TABLE "account_access_events" ADD CONSTRAINT "account_access_events_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_beta_access" ADD CONSTRAINT "account_beta_access_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "operator_command_receipts" ADD CONSTRAINT "operator_command_receipts_target_user_id_users_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mail_intents" ADD CONSTRAINT "mail_intents_recipient_user_id_users_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
--> --> ADR 0075: the participant audit and the operator command receipts are
--> append-only for the runtime role. Default privileges granted daisy_web
--> UPDATE and DELETE on every new table; take them back here.
REVOKE UPDATE, DELETE ON "account_access_events", "operator_command_receipts" FROM daisy_web;
--> statement-breakpoint
--> ADR 0075's grandfathered cohort: every live account that has claimed a
--> username (and so has a human actor) when this migration runs is approved.
--> Accounts without a username get a pending row when they claim one. The
--> event id is derived from the user id (a one-off backfill has no cuid2
--> source; the 24-character shape matches every application id).
INSERT INTO "account_beta_access" ("user_id", "state", "revision", "requested_at", "decided_at", "provenance")
SELECT u."id", 'approved', 1, u."created_at", now(), 'grandfathered'
FROM "users" u
WHERE u."deleted_at" IS NULL AND u."username" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "actors" a WHERE a."user_id" = u."id" AND a."kind" = 'human');
--> statement-breakpoint
INSERT INTO "account_access_events" ("id", "user_id", "command_id", "from_state", "to_state", "revision", "principal")
SELECT 'm' || left(md5('beta_access_expand:' || b."user_id"), 23), b."user_id", NULL, NULL, 'approved', 1, 'migration:beta_access_expand'
FROM "account_beta_access" b;
