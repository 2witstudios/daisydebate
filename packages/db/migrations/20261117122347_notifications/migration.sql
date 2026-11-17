CREATE TABLE "messaging_unread_emails" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"first_owed_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token_digest" text,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "messaging_unread_emails_state_check" CHECK ("state" in ('queued', 'leased', 'sent', 'failed', 'cancelled')),
	CONSTRAINT "messaging_unread_emails_attempts_check" CHECK ("attempts" >= 0),
	CONSTRAINT "messaging_unread_emails_lease_check" CHECK (("state" = 'leased') = ("lease_token_digest" is not null and "lease_expires_at" is not null) and ("lease_token_digest" is null or "lease_token_digest" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "messaging_unread_emails_completed_check" CHECK (("state" in ('sent', 'failed', 'cancelled')) = ("completed_at" is not null)),
	CONSTRAINT "messaging_unread_emails_error_check" CHECK ("last_error_code" is null or "last_error_code" in ('delivery', 'delivery-unknown', 'suppressed', 'recipient-gone', 'not-owed', 'unconfigured'))
);
--> statement-breakpoint
CREATE TABLE "notification_digests" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"first_owed_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token_digest" text,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "notification_digests_state_check" CHECK ("state" in ('queued', 'leased', 'sent', 'failed', 'cancelled')),
	CONSTRAINT "notification_digests_attempts_check" CHECK ("attempts" >= 0),
	CONSTRAINT "notification_digests_lease_check" CHECK (("state" = 'leased') = ("lease_token_digest" is not null and "lease_expires_at" is not null) and ("lease_token_digest" is null or "lease_token_digest" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "notification_digests_completed_check" CHECK (("state" in ('sent', 'failed', 'cancelled')) = ("completed_at" is not null)),
	CONSTRAINT "notification_digests_error_check" CHECK ("last_error_code" is null or "last_error_code" in ('delivery', 'delivery-unknown', 'suppressed', 'recipient-gone', 'not-owed', 'unconfigured'))
);
--> statement-breakpoint
CREATE TABLE "notification_presentation" (
	"user_id" text PRIMARY KEY,
	"toasts" boolean NOT NULL,
	"sound" boolean NOT NULL,
	"desktop_alerts" boolean NOT NULL,
	"email" boolean NOT NULL
);
--> statement-breakpoint
--> Per-notification email jobs give way to one digest per member (ADR 0144); a job still queued is not carried over.
DROP TABLE "notification_emails";--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "friendship_low_actor_id" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "friendship_high_actor_id" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "digest_id" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "surfaced_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
--> A row written before resurfacing existed last reached its member when it was written.
UPDATE "notifications" SET "surfaced_at" = "created_at";--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "decision_release" text DEFAULT 'on_finalize' NOT NULL;--> statement-breakpoint
DROP INDEX "notifications_challenge_once";--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_challenge_once" ON "notifications" ("user_id","kind","challenge_id") WHERE "challenge_id" is not null;--> statement-breakpoint
DROP INDEX "notifications_user_idx";--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" ("user_id","surfaced_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_unread_emails_one_queued" ON "messaging_unread_emails" ("user_id") WHERE "state" = 'queued';--> statement-breakpoint
CREATE INDEX "messaging_unread_emails_due_idx" ON "messaging_unread_emails" ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "messaging_unread_emails_user_idx" ON "messaging_unread_emails" ("user_id","completed_at");--> statement-breakpoint
CREATE INDEX "messaging_unread_emails_completed_idx" ON "messaging_unread_emails" ("completed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_digests_one_queued" ON "notification_digests" ("user_id") WHERE "state" = 'queued';--> statement-breakpoint
CREATE INDEX "notification_digests_due_idx" ON "notification_digests" ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "notification_digests_user_idx" ON "notification_digests" ("user_id","completed_at");--> statement-breakpoint
CREATE INDEX "notification_digests_completed_idx" ON "notification_digests" ("completed_at");--> statement-breakpoint
CREATE INDEX "notifications_challenge_idx" ON "notifications" ("challenge_id");--> statement-breakpoint
CREATE INDEX "notifications_digest_idx" ON "notifications" ("digest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_friendship_once" ON "notifications" ("user_id","kind","friendship_low_actor_id","friendship_high_actor_id") WHERE "friendship_low_actor_id" is not null;--> statement-breakpoint
CREATE INDEX "notifications_friendship_idx" ON "notifications" ("friendship_low_actor_id","friendship_high_actor_id");--> statement-breakpoint
ALTER TABLE "messaging_unread_emails" ADD CONSTRAINT "messaging_unread_emails_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_digests" ADD CONSTRAINT "notification_digests_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_presentation" ADD CONSTRAINT "notification_presentation_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_digest_id_notification_digests_id_fkey" FOREIGN KEY ("digest_id") REFERENCES "notification_digests"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_friendship_fk" FOREIGN KEY ("friendship_low_actor_id","friendship_high_actor_id") REFERENCES "friendships"("low_actor_id","high_actor_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_decision_release_check" CHECK ("decision_release" in ('on_finalize', 'held'));--> statement-breakpoint
--> A challenge is no longer emailed (ADR 0144): its stored email choice goes before the pair check refuses it.
DELETE FROM "notification_preferences" WHERE "kind" = 'challenge_received' AND "channel" = 'email';--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_pair_check", ADD CONSTRAINT "notification_preferences_pair_check" CHECK (("kind", "channel") in (('followed_debater_live', 'in_app'), ('recording_ready', 'in_app'), ('round_started', 'in_app'), ('round_decision_released', 'in_app'), ('round_decision_released', 'email'), ('room_invitation', 'in_app'), ('room_invitation', 'email'), ('challenge_received', 'in_app'), ('challenge_accepted', 'in_app'), ('friend_request_received', 'in_app'), ('friend_request_received', 'email'), ('friend_request_accepted', 'in_app')));--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check", ADD CONSTRAINT "notifications_kind_check" CHECK ("kind" in ('followed_debater_live', 'recording_ready', 'round_started', 'round_decision_released', 'room_invitation', 'challenge_received', 'challenge_accepted', 'friend_request_received', 'friend_request_accepted'));--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_subject_check", ADD CONSTRAINT "notifications_subject_check" CHECK (("kind" in ('followed_debater_live', 'recording_ready', 'round_started', 'round_decision_released')) = ("round_id" is not null) and ("kind" in ('room_invitation')) = ("room_invitation_id" is not null) and ("kind" in ('challenge_received', 'challenge_accepted')) = ("challenge_id" is not null) and ("kind" in ('friend_request_received', 'friend_request_accepted')) = ("friendship_low_actor_id" is not null) and ("kind" in ('friend_request_received', 'friend_request_accepted')) = ("friendship_high_actor_id" is not null));--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_actor_check", ADD CONSTRAINT "notifications_actor_check" CHECK (("kind" in ('recording_ready', 'round_started')) = ("actor_id" is null));