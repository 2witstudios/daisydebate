CREATE TABLE "audit_events" (
	"seq" bigint PRIMARY KEY,
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"operator_id" text,
	"command_id" text,
	"target_user_id" text,
	"outcome" text,
	"detail" text,
	"at" timestamp with time zone NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "audit_events_kind_check" CHECK ("kind" in ('enrollment.issued', 'operator.enrolled', 'auth.success', 'auth.failure', 'access.denied', 'credential.revoked', 'session.revoked')),
	CONSTRAINT "audit_events_detail_check" CHECK ("detail" is null or "detail" in ('initial', 'additional', 'replace', 'rate_limited', 'challenge_invalid', 'enrollment_invalid', 'credential_unknown', 'credential_duplicate', 'verification_failed', 'counter_regressed', 'operator_disabled', 'session_expired', 'session_idle', 'signed_out', 'rotated', 'replaced', 'role', 'approval_missing')),
	CONSTRAINT "audit_events_seq_positive" CHECK ("seq" >= 1)
);
--> statement-breakpoint
CREATE TABLE "auth_attempts" (
	"bucket" text PRIMARY KEY,
	"count" integer NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_attempts_count_positive" CHECK ("count" >= 1)
);
--> statement-breakpoint
CREATE TABLE "chain_checkpoints" (
	"seq" bigint PRIMARY KEY,
	"hash" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_challenges" (
	"id" text PRIMARY KEY,
	"purpose" text NOT NULL,
	"enrollment_id" text,
	"challenge_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "operator_challenges_purpose_check" CHECK ("purpose" in ('register', 'authenticate')),
	CONSTRAINT "operator_challenges_binding_check" CHECK (("purpose" = 'register') = ("enrollment_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "operator_credentials" (
	"id" text PRIMARY KEY,
	"operator_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"sign_count" bigint NOT NULL,
	"transports" text[] NOT NULL,
	"backed_up" boolean NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "operator_enrollments" (
	"id" text PRIMARY KEY,
	"operator_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"mode" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "operator_enrollments_mode_check" CHECK ("mode" in ('initial', 'additional', 'replace'))
);
--> statement-breakpoint
CREATE TABLE "operator_sessions" (
	"id" text PRIMARY KEY,
	"operator_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "operators" (
	"id" text PRIMARY KEY,
	"display_name" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"disabled_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "operators_role_check" CHECK ("role" in ('owner', 'operator')),
	CONSTRAINT "operators_revision_positive" CHECK ("revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_id_unique" ON "audit_events" ("id");--> statement-breakpoint
CREATE INDEX "auth_attempts_window_idx" ON "auth_attempts" ("window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "operator_challenges_challenge_hash_unique" ON "operator_challenges" ("challenge_hash");--> statement-breakpoint
CREATE INDEX "operator_challenges_enrollment_idx" ON "operator_challenges" ("enrollment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operator_credentials_credential_id_unique" ON "operator_credentials" ("credential_id");--> statement-breakpoint
CREATE INDEX "operator_credentials_operator_idx" ON "operator_credentials" ("operator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operator_enrollments_token_hash_unique" ON "operator_enrollments" ("token_hash");--> statement-breakpoint
CREATE INDEX "operator_enrollments_operator_idx" ON "operator_enrollments" ("operator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operator_sessions_token_hash_unique" ON "operator_sessions" ("token_hash");--> statement-breakpoint
CREATE INDEX "operator_sessions_operator_idx" ON "operator_sessions" ("operator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operators_one_active_owner" ON "operators" ("role") WHERE "role" = 'owner' and "disabled_at" is null;--> statement-breakpoint
ALTER TABLE "operator_challenges" ADD CONSTRAINT "operator_challenges_enrollment_id_operator_enrollments_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "operator_enrollments"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "operator_credentials" ADD CONSTRAINT "operator_credentials_operator_id_operators_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "operator_enrollments" ADD CONSTRAINT "operator_enrollments_operator_id_operators_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "operator_sessions" ADD CONSTRAINT "operator_sessions_operator_id_operators_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE RESTRICT;--> statement-breakpoint
--> The runtime role and its grants (ADR 0076); drizzle-kit generates none of
--> this. Roles are cluster-wide: staging creates daisy_admin_app with a
--> password before the first migration, and a local or CI cluster gets a
--> passwordless login here. The owner (the release-only migrate app's role)
--> owns every table; the runtime role may only append to and read the audit
--> chain, and may never create in the schema.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'daisy_admin_app') THEN
    CREATE ROLE daisy_admin_app LOGIN;
  END IF;
END
$$;--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM PUBLIC;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO daisy_admin_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON operators, operator_credentials, operator_enrollments, operator_challenges, operator_sessions, auth_attempts TO daisy_admin_app;--> statement-breakpoint
GRANT SELECT, INSERT ON audit_events TO daisy_admin_app;--> statement-breakpoint
GRANT SELECT ON chain_checkpoints TO daisy_admin_app;
