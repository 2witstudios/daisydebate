CREATE TABLE "pending_commands" (
	"command_id" text PRIMARY KEY,
	"operator_id" text NOT NULL,
	"target_user_id" text NOT NULL,
	"desired_state" text NOT NULL,
	"expected_revision" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "pending_commands_desired_state_check" CHECK ("desired_state" in ('approved', 'revoked')),
	CONSTRAINT "pending_commands_expected_revision_positive" CHECK ("expected_revision" >= 1)
);
--> statement-breakpoint
CREATE INDEX "pending_commands_open_idx" ON "pending_commands" ("created_at") WHERE "resolved_at" is null;--> statement-breakpoint
ALTER TABLE "pending_commands" ADD CONSTRAINT "pending_commands_operator_id_operators_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_kind_check", ADD CONSTRAINT "audit_events_kind_check" CHECK ("kind" in ('enrollment.issued', 'operator.enrolled', 'auth.success', 'auth.failure', 'access.denied', 'credential.revoked', 'session.revoked', 'command.intent', 'command.outcome', 'command.reconciled'));--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_detail_check", ADD CONSTRAINT "audit_events_detail_check" CHECK ("detail" is null or "detail" in ('initial', 'additional', 'replace', 'rate_limited', 'challenge_invalid', 'enrollment_invalid', 'credential_unknown', 'credential_duplicate', 'verification_failed', 'counter_regressed', 'operator_disabled', 'session_expired', 'session_idle', 'signed_out', 'rotated', 'replaced', 'role', 'approval_missing', 'approved', 'revoked', 'mail_none', 'mail_queued', 'mail_sent', 'mail_failed', 'mail_cancelled'));--> statement-breakpoint
--> The runtime role keeps and resolves its own pending commands (ADR 0077);
--> drizzle-kit generates no grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON pending_commands TO daisy_admin_app;
