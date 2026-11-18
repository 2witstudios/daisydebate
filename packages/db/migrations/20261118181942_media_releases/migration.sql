CREATE TABLE "media_release_club_asks" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"asked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "media_release_club_asks_finite" CHECK (isfinite("asked_at"))
);
--> statement-breakpoint
CREATE TABLE "media_release_club_attestations" (
	"release_id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"attested_by_user_id" text,
	"attester_name" text NOT NULL,
	"attester_role" text NOT NULL,
	CONSTRAINT "media_release_club_attestations_text_check" CHECK (char_length("attester_name") between 1 and 120
        and char_length("attester_role") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "media_release_links" (
	"id" text PRIMARY KEY,
	"token_digest" text NOT NULL UNIQUE,
	"purpose" text NOT NULL,
	"request_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_release_links_purpose_check" CHECK ("purpose" in ('sign', 'manage')),
	CONSTRAINT "media_release_links_digest_check" CHECK ("token_digest" ~ '^(sign|manage):[0-9a-f]{64}$' and split_part("token_digest", ':', 1) = "purpose"),
	CONSTRAINT "media_release_links_expiry_check" CHECK (isfinite("expires_at"))
);
--> statement-breakpoint
CREATE TABLE "media_release_mails" (
	"id" text PRIMARY KEY,
	"kind" text NOT NULL,
	"request_id" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token_digest" text,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "media_release_mails_kind_check" CHECK ("kind" in ('request', 'reminder', 'copy', 'manage_link')),
	CONSTRAINT "media_release_mails_state_check" CHECK ("state" in ('queued', 'leased', 'sent', 'failed', 'cancelled')),
	CONSTRAINT "media_release_mails_attempts_check" CHECK ("attempts" >= 0),
	CONSTRAINT "media_release_mails_lease_check" CHECK (("state" = 'leased') = ("lease_token_digest" is not null and "lease_expires_at" is not null) and ("lease_token_digest" is null or "lease_token_digest" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "media_release_mails_completed_check" CHECK (("state" in ('sent', 'failed', 'cancelled')) = ("completed_at" is not null)),
	CONSTRAINT "media_release_mails_error_check" CHECK ("last_error_code" is null or "last_error_code" in ('delivery', 'delivery-unknown', 'suppressed', 'not-owed', 'unconfigured'))
);
--> statement-breakpoint
CREATE TABLE "media_release_requests" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"recipient_email" text NOT NULL,
	"recipient_hash" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"outcome" text,
	"resolved_at" timestamp with time zone,
	"sends" integer DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp with time zone,
	CONSTRAINT "media_release_requests_outcome_check" CHECK (("outcome" is null) = ("resolved_at" is null) and ("outcome" is null or "outcome" in ('signed', 'declined', 'not_me', 'cancelled', 'superseded', 'expired', 'stopped'))),
	CONSTRAINT "media_release_requests_email_check" CHECK ("recipient_email" = lower(btrim("recipient_email")) and length("recipient_email") between 3 and 254),
	CONSTRAINT "media_release_requests_hash_check" CHECK ("recipient_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "media_release_requests_expiry_check" CHECK (isfinite("expires_at") and "expires_at" > "requested_at"),
	CONSTRAINT "media_release_requests_sends_check" CHECK ("sends" between 0 and 5)
);
--> statement-breakpoint
CREATE TABLE "media_release_stops" (
	"recipient_hash" text PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_release_stops_hash_check" CHECK ("recipient_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "media_releases" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"scope" text NOT NULL,
	"source" text NOT NULL,
	"request_id" text,
	"signer_name" text,
	"signer_relation" text,
	"signer_email" text,
	"wording_version" text NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by" text,
	"withdrawal_note" text,
	CONSTRAINT "media_releases_scope_check" CHECK ("scope" in ('publish', 'paid_ads')),
	CONSTRAINT "media_releases_source_check" CHECK ("source" in ('parent', 'club')),
	CONSTRAINT "media_releases_parent_check" CHECK (("source" = 'parent') = ("signer_name" is not null and "signer_relation" is not null and "signer_email" is not null)
        and ("signer_name" is null or char_length("signer_name") between 1 and 120)
        and ("signer_relation" is null or "signer_relation" in ('parent', 'legal_guardian'))
        and ("signer_email" is null or "signer_email" = lower(btrim("signer_email")) and length("signer_email") between 3 and 254)),
	CONSTRAINT "media_releases_withdrawn_check" CHECK (("withdrawn_at" is null) = ("withdrawn_by" is null)
        and ("withdrawn_by" is null or "withdrawn_by" in ('parent', 'club', 'erasure'))
        and ("withdrawal_note" is null or ("withdrawn_at" is not null and char_length("withdrawal_note") <= 1000))
        and ("withdrawn_at" is null or "withdrawn_at" >= "signed_at")),
	CONSTRAINT "media_releases_signed_finite" CHECK (isfinite("signed_at") and char_length("wording_version") between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "youth_round_publications" (
	"round_id" text PRIMARY KEY,
	"published_by_user_id" text,
	"published_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "youth_round_publications_ended_check" CHECK (isfinite("published_at") and ("ended_at" is null or "ended_at" >= "published_at"))
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "media_release_request_id" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "media_release_id" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "media_release_club_ask_id" text;--> statement-breakpoint
CREATE INDEX "media_release_club_asks_organization_idx" ON "media_release_club_asks" ("organization_id","asked_at");--> statement-breakpoint
CREATE INDEX "media_release_club_asks_user_idx" ON "media_release_club_asks" ("user_id","asked_at");--> statement-breakpoint
CREATE INDEX "media_release_club_attestations_organization_idx" ON "media_release_club_attestations" ("organization_id");--> statement-breakpoint
CREATE INDEX "media_release_club_attestations_user_idx" ON "media_release_club_attestations" ("user_id");--> statement-breakpoint
CREATE INDEX "media_release_club_attestations_attested_by_idx" ON "media_release_club_attestations" ("attested_by_user_id");--> statement-breakpoint
CREATE INDEX "media_release_links_request_idx" ON "media_release_links" ("request_id");--> statement-breakpoint
CREATE INDEX "media_release_mails_request_idx" ON "media_release_mails" ("request_id");--> statement-breakpoint
CREATE INDEX "media_release_mails_due_idx" ON "media_release_mails" ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "media_release_mails_completed_idx" ON "media_release_mails" ("completed_at");--> statement-breakpoint
CREATE INDEX "media_release_requests_recipient_hash_idx" ON "media_release_requests" ("recipient_hash") WHERE "outcome" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "media_release_requests_one_open" ON "media_release_requests" ("user_id") WHERE "outcome" is null;--> statement-breakpoint
CREATE INDEX "media_release_requests_user_idx" ON "media_release_requests" ("user_id","requested_at");--> statement-breakpoint
CREATE INDEX "media_release_requests_ended_idx" ON "media_release_requests" ("resolved_at","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_releases_one_active" ON "media_releases" ("user_id","scope") WHERE "withdrawn_at" is null;--> statement-breakpoint
CREATE INDEX "media_releases_user_idx" ON "media_releases" ("user_id","signed_at");--> statement-breakpoint
CREATE INDEX "media_releases_request_idx" ON "media_releases" ("request_id");--> statement-breakpoint
CREATE INDEX "media_releases_withdrawn_idx" ON "media_releases" ("withdrawn_at");--> statement-breakpoint
CREATE INDEX "youth_round_publications_published_by_idx" ON "youth_round_publications" ("published_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_media_release_request_once" ON "notifications" ("user_id","kind","media_release_request_id") WHERE "media_release_request_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_media_release_once" ON "notifications" ("user_id","kind","media_release_id") WHERE "media_release_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_media_release_club_ask_once" ON "notifications" ("user_id","kind","media_release_club_ask_id") WHERE "media_release_club_ask_id" is not null;--> statement-breakpoint
CREATE INDEX "notifications_media_release_request_idx" ON "notifications" ("media_release_request_id");--> statement-breakpoint
CREATE INDEX "notifications_media_release_idx" ON "notifications" ("media_release_id");--> statement-breakpoint
CREATE INDEX "notifications_media_release_club_ask_idx" ON "notifications" ("media_release_club_ask_id");--> statement-breakpoint
ALTER TABLE "media_release_club_asks" ADD CONSTRAINT "media_release_club_asks_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "media_release_club_asks" ADD CONSTRAINT "media_release_club_asks_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "media_release_club_attestations" ADD CONSTRAINT "media_release_club_attestations_bDm8lf9vTJ2n_fkey" FOREIGN KEY ("release_id") REFERENCES "media_releases"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "media_release_club_attestations" ADD CONSTRAINT "media_release_club_attestations_mlczrCYHy0qY_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "media_release_club_attestations" ADD CONSTRAINT "media_release_club_attestations_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "media_release_club_attestations" ADD CONSTRAINT "media_release_club_attestations_GlQ733soOUdd_fkey" FOREIGN KEY ("attested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "media_release_links" ADD CONSTRAINT "media_release_links_request_id_media_release_requests_id_fkey" FOREIGN KEY ("request_id") REFERENCES "media_release_requests"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "media_release_mails" ADD CONSTRAINT "media_release_mails_request_id_media_release_requests_id_fkey" FOREIGN KEY ("request_id") REFERENCES "media_release_requests"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "media_release_requests" ADD CONSTRAINT "media_release_requests_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "media_releases" ADD CONSTRAINT "media_releases_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "media_releases" ADD CONSTRAINT "media_releases_request_id_media_release_requests_id_fkey" FOREIGN KEY ("request_id") REFERENCES "media_release_requests"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "youth_round_publications" ADD CONSTRAINT "youth_round_publications_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "youth_round_publications" ADD CONSTRAINT "youth_round_publications_published_by_user_id_users_id_fkey" FOREIGN KEY ("published_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_Jv2SoVctkXIp_fkey" FOREIGN KEY ("media_release_request_id") REFERENCES "media_release_requests"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_media_release_id_media_releases_id_fkey" FOREIGN KEY ("media_release_id") REFERENCES "media_releases"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_KlUC91rDK59R_fkey" FOREIGN KEY ("media_release_club_ask_id") REFERENCES "media_release_club_asks"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_pair_check", ADD CONSTRAINT "notification_preferences_pair_check" CHECK (("kind", "channel") in (('followed_debater_live', 'in_app'), ('recording_ready', 'in_app'), ('round_started', 'in_app'), ('round_decision_released', 'in_app'), ('round_decision_released', 'email'), ('room_invitation', 'in_app'), ('room_invitation', 'email'), ('challenge_received', 'in_app'), ('challenge_accepted', 'in_app'), ('friend_request_received', 'in_app'), ('friend_request_received', 'email'), ('friend_request_accepted', 'in_app'), ('judge_assigned', 'in_app'), ('judge_replaced', 'in_app'), ('judge_unassigned', 'in_app'), ('tournament_draw_changed', 'in_app'), ('tournament_room_ready', 'in_app'), ('tournament_results_released', 'in_app'), ('media_release_requested', 'in_app'), ('media_release_declined', 'in_app'), ('media_release_signed', 'in_app'), ('media_release_club_confirmed', 'in_app'), ('media_release_withdrawn', 'in_app'), ('media_release_club_asked', 'in_app'), ('youth_round_published', 'in_app')));--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check", ADD CONSTRAINT "notifications_kind_check" CHECK ("kind" in ('followed_debater_live', 'recording_ready', 'round_started', 'round_decision_released', 'room_invitation', 'challenge_received', 'challenge_accepted', 'friend_request_received', 'friend_request_accepted', 'judge_assigned', 'judge_replaced', 'judge_unassigned', 'tournament_draw_changed', 'tournament_room_ready', 'tournament_results_released', 'media_release_requested', 'media_release_declined', 'media_release_signed', 'media_release_club_confirmed', 'media_release_withdrawn', 'media_release_club_asked', 'youth_round_published'));--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_subject_check", ADD CONSTRAINT "notifications_subject_check" CHECK (("kind" in ('followed_debater_live', 'recording_ready', 'round_started', 'round_decision_released', 'youth_round_published')) = ("round_id" is not null) and ("kind" in ('room_invitation')) = ("room_invitation_id" is not null) and ("kind" in ('challenge_received', 'challenge_accepted')) = ("challenge_id" is not null) and ("kind" in ('friend_request_received', 'friend_request_accepted')) = ("friendship_low_actor_id" is not null) and ("kind" in ('friend_request_received', 'friend_request_accepted')) = ("friendship_high_actor_id" is not null) and ("kind" in ('judge_assigned', 'judge_replaced', 'judge_unassigned', 'tournament_draw_changed', 'tournament_room_ready', 'tournament_results_released')) = ("fixture_id" is not null) and ("kind" in ('judge_assigned', 'judge_replaced', 'judge_unassigned', 'tournament_draw_changed', 'tournament_room_ready', 'tournament_results_released')) = ("notification_lobby_id" is not null) and ("kind" in ('judge_assigned', 'judge_replaced', 'judge_unassigned', 'tournament_draw_changed', 'tournament_room_ready', 'tournament_results_released')) = ("tab_command_id" is not null) and ("kind" in ('media_release_requested', 'media_release_declined')) = ("media_release_request_id" is not null) and ("kind" in ('media_release_signed', 'media_release_club_confirmed', 'media_release_withdrawn')) = ("media_release_id" is not null) and ("kind" in ('media_release_club_asked')) = ("media_release_club_ask_id" is not null));--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_actor_check", ADD CONSTRAINT "notifications_actor_check" CHECK (("kind" in ('recording_ready', 'round_started', 'judge_assigned', 'judge_replaced', 'judge_unassigned', 'tournament_draw_changed', 'tournament_room_ready', 'tournament_results_released', 'media_release_requested', 'media_release_declined', 'media_release_signed', 'media_release_club_confirmed', 'media_release_withdrawn')) = ("actor_id" is null));--> statement-breakpoint
ALTER TABLE "media_release_club_attestations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "media_release_club_attestations_scope" ON "media_release_club_attestations" FOR ALL USING (organization_id = daisy_organization_scope()) WITH CHECK (organization_id = daisy_organization_scope());
--> statement-breakpoint
CREATE POLICY "media_release_club_attestations_subject" ON "media_release_club_attestations" FOR SELECT USING (user_id = daisy_subject_scope());
