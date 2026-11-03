CREATE TABLE "agreement_signatures" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"agreement" text NOT NULL,
	"version" text NOT NULL,
	"season_id" text,
	"room_id" text,
	"signed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agreement_signatures_once" UNIQUE NULLS NOT DISTINCT("user_id","agreement","version","season_id","room_id"),
	CONSTRAINT "agreement_signatures_agreement_check" CHECK ("agreement" in ('ranked-content-waiver', 'round-capture-notice')),
	CONSTRAINT "agreement_signatures_scope_check" CHECK (("agreement" = 'ranked-content-waiver' and "season_id" is not null and "room_id" is null)
        or ("agreement" = 'round-capture-notice' and "room_id" is not null and "season_id" is null))
);
--> statement-breakpoint
CREATE TABLE "audience_reactions" (
	"id" text PRIMARY KEY,
	"round_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"spaced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "audience_reactions_kind_check" CHECK ("kind" in ('sharp_point', 'good_rebuttal', 'needs_evidence', 'clear_structure'))
);
--> statement-breakpoint
CREATE TABLE "broadcasts" (
	"id" text PRIMARY KEY,
	"round_id" text NOT NULL,
	"delivery_path" text DEFAULT 'owned_hls' NOT NULL,
	"release_policy" jsonb NOT NULL,
	"debaters_read_chat" boolean DEFAULT false NOT NULL,
	"chat_slow_mode_seconds" integer DEFAULT 0 NOT NULL,
	"stage_credential_hash" text,
	"egress_id" text,
	"egress_started_at" timestamp with time zone,
	"observer_revoked_at" timestamp with time zone,
	"revocation_failures" integer DEFAULT 0 NOT NULL,
	"next_segment" integer DEFAULT 0 NOT NULL,
	"egress_generation" integer DEFAULT 0 NOT NULL,
	"released_generation" integer DEFAULT 1 NOT NULL,
	"hold_cursor" integer DEFAULT 0 NOT NULL,
	"stream_ended_at" timestamp with time zone,
	"released_through_at" timestamp with time zone,
	"final_media_end_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"stop_reason" text,
	"completed_at" timestamp with time zone,
	"feed_withdrawn_at" timestamp with time zone,
	"reconcile_lease_until" timestamp with time zone,
	"lease_epoch" integer DEFAULT 0 NOT NULL,
	"lease_owner" text,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "broadcasts_delivery_path_check" CHECK ("delivery_path" in ('owned_hls')),
	CONSTRAINT "broadcasts_release_policy_is_object" CHECK (jsonb_typeof("release_policy") = 'object'),
	CONSTRAINT "broadcasts_release_policy_check" CHECK ("release_policy"->>'kind' in ('delay','round_end','at')),
	CONSTRAINT "broadcasts_cursor_check" CHECK ("next_segment" >= 0 and "hold_cursor" >= 0 and "egress_generation" >= 0 and "released_generation" >= 1 and "revocation_failures" >= 0 and "lease_epoch" >= 0 and "chat_slow_mode_seconds" between 0 and 3600),
	CONSTRAINT "broadcasts_lease_check" CHECK (("lease_owner" is null) = ("lease_until" is null)),
	CONSTRAINT "broadcasts_stop_check" CHECK (("stopped_at" is null) = ("stop_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "audience_bans" (
	"user_id" text PRIMARY KEY,
	"banned_by_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_reports" (
	"id" text PRIMARY KEY,
	"reporter_user_id" text,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"feedback_side" text,
	"reason" text NOT NULL,
	"queue" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_reports_target_kind_check" CHECK ("target_kind" in ('round', 'recording', 'chat_message', 'ballot_feedback')),
	CONSTRAINT "content_reports_reason_check" CHECK ("reason" in ('harassment', 'hate', 'sexual_content', 'violence', 'self_harm', 'impersonation', 'spam', 'other', 'result_dispute', 'integrity_concern', 'abusive_feedback')),
	CONSTRAINT "content_reports_queue_check" CHECK ("queue" in ('safety', 'review')),
	CONSTRAINT "content_reports_status_check" CHECK ("status" in ('open', 'upheld', 'dismissed')),
	CONSTRAINT "content_reports_feedback_side_check" CHECK (("target_kind" = 'ballot_feedback') = ("feedback_side" is not null) and ("feedback_side" is null or "feedback_side" in ('affirmative', 'negative'))),
	CONSTRAINT "content_reports_resolution_check" CHECK (("status" = 'open') = ("resolved_at" is null) and ("resolved_at" is null) = ("resolved_by_ref" is null))
);
--> statement-breakpoint
CREATE TABLE "debater_follows" (
	"follower_user_id" text,
	"debater_actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "debater_follows_pkey" PRIMARY KEY("follower_user_id","debater_actor_id")
);
--> statement-breakpoint
CREATE TABLE "notification_fanouts" (
	"kind" text,
	"round_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_fanouts_pkey" PRIMARY KEY("kind","round_id"),
	CONSTRAINT "notification_fanouts_kind_check" CHECK ("kind" in ('followed_debater_live', 'recording_ready'))
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" text,
	"kind" text,
	"enabled" boolean NOT NULL,
	CONSTRAINT "notification_preferences_pkey" PRIMARY KEY("user_id","kind"),
	CONSTRAINT "notification_preferences_kind_check" CHECK ("kind" in ('followed_debater_live', 'recording_ready'))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"round_id" text NOT NULL,
	"debater_actor_id" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_kind_check" CHECK ("kind" in ('followed_debater_live', 'recording_ready')),
	CONSTRAINT "notifications_debater_check" CHECK (("kind" = 'followed_debater_live') = ("debater_actor_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "recordings" (
	"id" text PRIMARY KEY,
	"round_id" text NOT NULL,
	"recording_class" text NOT NULL,
	"eligibility" jsonb NOT NULL,
	"status" text NOT NULL,
	"lifecycle" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deletion_attempts" integer DEFAULT 0 NOT NULL,
	"deletion_due_at" timestamp with time zone,
	"lease_owner" text,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recordings_class_check" CHECK ("recording_class" in ('ranked', 'casual')),
	CONSTRAINT "recordings_status_check" CHECK ("status" in ('requested', 'capturing', 'processing', 'ready', 'failed', 'taken_down', 'removing', 'removed')),
	CONSTRAINT "recordings_eligibility_is_object" CHECK (jsonb_typeof("eligibility") = 'object'),
	CONSTRAINT "recordings_lifecycle_is_object" CHECK (jsonb_typeof("lifecycle") = 'object'),
	CONSTRAINT "recordings_lifecycle_status_check" CHECK ("lifecycle"->>'status' = "status"),
	CONSTRAINT "recordings_class_matches_eligibility_check" CHECK (("recording_class" = 'ranked') = ("eligibility"->>'kind' = 'ranked')),
	CONSTRAINT "recordings_deletion_attempts_check" CHECK ("deletion_attempts" >= 0),
	CONSTRAINT "recordings_lease_check" CHECK (("lease_owner" is null) = ("lease_until" is null)),
	CONSTRAINT "recordings_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "spectator_fact_releases" (
	"round_id" text,
	"kind" text,
	"fact_id" text,
	"captured_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone NOT NULL,
	"watermark_at" timestamp with time zone,
	"basis" text NOT NULL,
	CONSTRAINT "spectator_fact_releases_pkey" PRIMARY KEY("round_id","kind","fact_id"),
	CONSTRAINT "spectator_fact_releases_kind_check" CHECK ("kind" in ('stage', 'result', 'ballot', 'rating', 'caption')),
	CONSTRAINT "spectator_fact_releases_basis_check" CHECK ("basis" in ('watermark', 'clock_fallback', 'broadcast_ended', 'no_broadcast')),
	CONSTRAINT "spectator_fact_releases_after_capture_check" CHECK ("released_at" >= "captured_at")
);
--> statement-breakpoint
CREATE TABLE "watch_history" (
	"user_id" text,
	"round_id" text,
	"watched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "watch_history_pkey" PRIMARY KEY("user_id","round_id")
);
--> statement-breakpoint
ALTER TABLE "rounds" RENAME CONSTRAINT "rounds_rated_ladder_check" TO "rounds_ranked_ladder_check";--> statement-breakpoint
ALTER TABLE "messaging_channels" ADD COLUMN "round_id" text;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "capture" jsonb;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "capture" jsonb;--> statement-breakpoint
ALTER TABLE "operator_command_receipts" ALTER COLUMN "target_user_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "agreement_signatures_season_idx" ON "agreement_signatures" ("season_id");--> statement-breakpoint
CREATE INDEX "agreement_signatures_room_idx" ON "agreement_signatures" ("room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audience_reactions_spaced_unique" ON "audience_reactions" ("round_id","user_id","kind","spaced_at");--> statement-breakpoint
CREATE INDEX "audience_reactions_round_idx" ON "audience_reactions" ("round_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "audience_reactions_user_idx" ON "audience_reactions" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "broadcasts_round_unique" ON "broadcasts" ("round_id");--> statement-breakpoint
CREATE INDEX "broadcasts_open_idx" ON "broadcasts" ("created_at") WHERE "completed_at" is null;--> statement-breakpoint
CREATE INDEX "broadcasts_feed_up_idx" ON "broadcasts" ("created_at") WHERE "feed_withdrawn_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "content_reports_once_unique" ON "content_reports" ("reporter_user_id","target_kind","target_id");--> statement-breakpoint
CREATE INDEX "content_reports_queue_idx" ON "content_reports" ("queue","status","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "debater_follows_debater_idx" ON "debater_follows" ("debater_actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_channels_round_unique" ON "messaging_channels" ("round_id");--> statement-breakpoint
CREATE INDEX "notification_fanouts_round_idx" ON "notification_fanouts" ("round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_once_unique" ON "notifications" ("user_id","kind","round_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_read_idx" ON "notifications" ("read_at") WHERE "read_at" is not null;--> statement-breakpoint
CREATE INDEX "notifications_round_idx" ON "notifications" ("round_id");--> statement-breakpoint
CREATE INDEX "notifications_debater_idx" ON "notifications" ("debater_actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recordings_round_unique" ON "recordings" ("round_id");--> statement-breakpoint
CREATE INDEX "recordings_status_idx" ON "recordings" ("status","updated_at");--> statement-breakpoint
CREATE INDEX "recordings_deletion_due_idx" ON "recordings" ("deletion_due_at") WHERE "status" = 'removing';--> statement-breakpoint
CREATE INDEX "spectator_fact_releases_round_idx" ON "spectator_fact_releases" ("round_id","released_at");--> statement-breakpoint
CREATE INDEX "watch_history_user_idx" ON "watch_history" ("user_id","watched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "watch_history_retention_idx" ON "watch_history" ("watched_at");--> statement-breakpoint
CREATE INDEX "watch_history_round_idx" ON "watch_history" ("round_id");--> statement-breakpoint
ALTER TABLE "agreement_signatures" ADD CONSTRAINT "agreement_signatures_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agreement_signatures" ADD CONSTRAINT "agreement_signatures_season_id_seasons_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "agreement_signatures" ADD CONSTRAINT "agreement_signatures_room_id_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "audience_reactions" ADD CONSTRAINT "audience_reactions_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "audience_reactions" ADD CONSTRAINT "audience_reactions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "audience_bans" ADD CONSTRAINT "audience_bans_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_reporter_user_id_users_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "debater_follows" ADD CONSTRAINT "debater_follows_follower_user_id_users_id_fkey" FOREIGN KEY ("follower_user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "debater_follows" ADD CONSTRAINT "debater_follows_debater_actor_id_actors_id_fkey" FOREIGN KEY ("debater_actor_id") REFERENCES "actors"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "messaging_channels" ADD CONSTRAINT "messaging_channels_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_fanouts" ADD CONSTRAINT "notification_fanouts_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_debater_actor_id_actors_id_fkey" FOREIGN KEY ("debater_actor_id") REFERENCES "actors"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "spectator_fact_releases" ADD CONSTRAINT "spectator_fact_releases_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "watch_history" ADD CONSTRAINT "watch_history_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "watch_history" ADD CONSTRAINT "watch_history_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "messaging_channels" ADD CONSTRAINT "messaging_channels_round" CHECK (("kind" = 'round_spectator') = ("round_id" is not null));--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_ranked_public_check" CHECK ("competition_type" <> 'ranked' or "visibility" = 'public');--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_capture_is_object" CHECK (jsonb_typeof("capture") = 'object');--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_capture_is_object" CHECK (jsonb_typeof("capture") = 'object');--> statement-breakpoint
ALTER TABLE "account_entitlement_grants" DROP CONSTRAINT "account_entitlement_grants_entitlement_check", ADD CONSTRAINT "account_entitlement_grants_entitlement_check" CHECK ("entitlement" in ('round_analysis', 'ai_rounds', 'casual_ai_judge', 'casual_capture'));--> statement-breakpoint
ALTER TABLE "messaging_channels" DROP CONSTRAINT "messaging_channels_kind", ADD CONSTRAINT "messaging_channels_kind" CHECK ("kind" in ('dm', 'private_group', 'round_spectator'));--> statement-breakpoint
ALTER TABLE "messaging_channels" DROP CONSTRAINT "messaging_channels_policy", ADD CONSTRAINT "messaging_channels_policy" CHECK ("policy_revision" > 0 and (("kind" = 'dm' and "policy_key" = 'social.dm') or ("kind" = 'private_group' and "policy_key" = 'social.private_group') or ("kind" = 'round_spectator' and "policy_key" = 'round.spectator')));
--> statement-breakpoint
-- WATCH-16 and WATCH-8: beta approval grants these until billing exists, so every
-- account already approved holds them, as the beta access command now writes.
INSERT INTO "account_entitlement_grants" ("user_id", "entitlement", "source")
SELECT "user_id", kind, 'beta'
FROM "account_beta_access", (VALUES ('casual_ai_judge'), ('casual_capture')) AS kinds(kind)
WHERE "state" = 'approved';
--> statement-breakpoint
-- daisy_broadcast_worker: the hold worker's only credential (ADR 0099, BCAST-4).
-- It reads and updates broadcasts and touches nothing else, so it cannot read or
-- change a Round. Explicit grants only. No password here: staging and production
-- provision the credential out of band.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'daisy_broadcast_worker') THEN
    CREATE ROLE daisy_broadcast_worker LOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO daisy_broadcast_worker;
--> statement-breakpoint
GRANT SELECT, UPDATE ON broadcasts TO daisy_broadcast_worker;
--> statement-breakpoint
-- Hand-written part of the migration: add after the bun db:generate output for the table.
CREATE FUNCTION guard_spectator_fact_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- The Round's own erasure cascades here after its row is gone.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM rounds WHERE id = OLD.round_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'The spectator fact log is append-only'
    USING ERRCODE = 'check_violation', CONSTRAINT = 'spectator_fact_releases_append_only';
END $$;
CREATE TRIGGER spectator_fact_releases_append_only
  BEFORE UPDATE OR DELETE ON spectator_fact_releases
  FOR EACH ROW EXECUTE FUNCTION guard_spectator_fact_release();
