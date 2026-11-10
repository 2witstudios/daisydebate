CREATE TABLE "notification_emails" (
	"id" text PRIMARY KEY,
	"notification_id" text UNIQUE,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"state" text NOT NULL,
	"attempts" integer NOT NULL,
	"lease_token_digest" text,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "notification_emails_kind_check" CHECK ("kind" in ('room_invitation', 'challenge_received')),
	CONSTRAINT "notification_emails_state_check" CHECK ("state" in ('queued', 'leased', 'sent', 'failed', 'cancelled')),
	CONSTRAINT "notification_emails_attempts_check" CHECK ("attempts" >= 0),
	CONSTRAINT "notification_emails_lease_check" CHECK (("state" = 'leased') = ("lease_token_digest" is not null and "lease_expires_at" is not null) and ("lease_token_digest" is null or "lease_token_digest" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "notification_emails_completed_check" CHECK (("state" in ('sent', 'failed', 'cancelled')) = ("completed_at" is not null)),
	CONSTRAINT "notification_emails_error_check" CHECK ("last_error_code" is null or "last_error_code" in ('delivery', 'delivery-unknown', 'suppressed', 'recipient-gone', 'not-owed', 'preference-off', 'rate-limited', 'unconfigured'))
);
--> statement-breakpoint
CREATE TABLE "room_invitations" (
	"id" text PRIMARY KEY,
	"room_id" text NOT NULL,
	"invitee_actor_id" text NOT NULL,
	"inviter_actor_id" text NOT NULL,
	"seat" text NOT NULL,
	"state" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_invitations_seat_check" CHECK ("seat" in ('debater', 'judge')),
	CONSTRAINT "room_invitations_state_check" CHECK ("state" in ('pending', 'accepted', 'declined', 'withdrawn', 'expired')),
	CONSTRAINT "room_invitations_ended_check" CHECK (("state" = 'pending') = ("ended_at" is null)),
	CONSTRAINT "room_invitations_distinct" CHECK ("invitee_actor_id" <> "inviter_actor_id")
);
--> statement-breakpoint
ALTER TABLE "notifications" RENAME COLUMN "debater_actor_id" TO "actor_id";--> statement-breakpoint
ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_kind_check";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_debater_check";--> statement-breakpoint
ALTER INDEX "notifications_debater_idx" RENAME TO "notifications_actor_idx";--> statement-breakpoint
DROP INDEX "notifications_once_unique";--> statement-breakpoint
--> Every stored choice so far was an in-app one.
ALTER TABLE "notification_preferences" ADD COLUMN "channel" text DEFAULT 'in_app' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preferences" ALTER COLUMN "channel" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "room_invitation_id" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "challenge_id" text;--> statement-breakpoint
--> Every hold so far was a challenge's debater hold.
ALTER TABLE "room_seat_holds" ADD COLUMN "seat" text DEFAULT 'debater' NOT NULL;--> statement-breakpoint
ALTER TABLE "room_seat_holds" ALTER COLUMN "seat" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_pkey";--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD PRIMARY KEY ("user_id","kind","channel");--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "round_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "notification_emails_due_idx" ON "notification_emails" ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "notification_emails_user_idx" ON "notification_emails" ("user_id","completed_at");--> statement-breakpoint
CREATE INDEX "notification_emails_completed_idx" ON "notification_emails" ("completed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_round_once" ON "notifications" ("user_id","kind","round_id") WHERE "round_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_invitation_once" ON "notifications" ("room_invitation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_challenge_once" ON "notifications" ("challenge_id");--> statement-breakpoint
CREATE UNIQUE INDEX "room_invitations_one_pending" ON "room_invitations" ("room_id","invitee_actor_id") WHERE "state" = 'pending';--> statement-breakpoint
CREATE INDEX "room_invitations_room_idx" ON "room_invitations" ("room_id");--> statement-breakpoint
CREATE INDEX "room_invitations_invitee_idx" ON "room_invitations" ("invitee_actor_id");--> statement-breakpoint
CREATE INDEX "room_invitations_inviter_idx" ON "room_invitations" ("inviter_actor_id");--> statement-breakpoint
CREATE INDEX "room_invitations_ended_idx" ON "room_invitations" ("ended_at") WHERE "ended_at" is not null;--> statement-breakpoint
ALTER TABLE "notification_emails" ADD CONSTRAINT "notification_emails_notification_id_notifications_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "notification_emails" ADD CONSTRAINT "notification_emails_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_room_invitation_id_room_invitations_id_fkey" FOREIGN KEY ("room_invitation_id") REFERENCES "room_invitations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_challenge_id_challenges_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "room_invitations" ADD CONSTRAINT "room_invitations_room_id_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "room_invitations" ADD CONSTRAINT "room_invitations_invitee_actor_id_actors_id_fkey" FOREIGN KEY ("invitee_actor_id") REFERENCES "actors"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "room_invitations" ADD CONSTRAINT "room_invitations_inviter_actor_id_actors_id_fkey" FOREIGN KEY ("inviter_actor_id") REFERENCES "actors"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_pair_check" CHECK (("kind", "channel") in (('followed_debater_live', 'in_app'), ('recording_ready', 'in_app'), ('room_invitation', 'in_app'), ('room_invitation', 'email'), ('challenge_received', 'in_app'), ('challenge_received', 'email')));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_subject_check" CHECK (("kind" in ('followed_debater_live', 'recording_ready')) = ("round_id" is not null)
        and ("kind" = 'room_invitation') = ("room_invitation_id" is not null)
        and ("kind" = 'challenge_received') = ("challenge_id" is not null));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_check" CHECK (("kind" = 'recording_ready') = ("actor_id" is null));--> statement-breakpoint
ALTER TABLE "room_seat_holds" ADD CONSTRAINT "room_seat_holds_seat_check" CHECK ("seat" in ('debater', 'judge'));--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check", ADD CONSTRAINT "notifications_kind_check" CHECK ("kind" in ('followed_debater_live', 'recording_ready', 'room_invitation', 'challenge_received'));