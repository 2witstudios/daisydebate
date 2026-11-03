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
CREATE TABLE "watch_history" (
	"user_id" text,
	"round_id" text,
	"watched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "watch_history_pkey" PRIMARY KEY("user_id","round_id")
);
--> statement-breakpoint
ALTER TABLE "messaging_channels" ADD COLUMN "round_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "audience_reactions_spaced_unique" ON "audience_reactions" ("round_id","user_id","kind","spaced_at");--> statement-breakpoint
CREATE INDEX "audience_reactions_round_idx" ON "audience_reactions" ("round_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "audience_reactions_user_idx" ON "audience_reactions" ("user_id");--> statement-breakpoint
CREATE INDEX "debater_follows_debater_idx" ON "debater_follows" ("debater_actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_channels_round_unique" ON "messaging_channels" ("round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_once_unique" ON "notifications" ("user_id","kind","round_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_read_idx" ON "notifications" ("read_at") WHERE "read_at" is not null;--> statement-breakpoint
CREATE INDEX "notifications_round_idx" ON "notifications" ("round_id");--> statement-breakpoint
CREATE INDEX "notifications_debater_idx" ON "notifications" ("debater_actor_id");--> statement-breakpoint
CREATE INDEX "watch_history_user_idx" ON "watch_history" ("user_id","watched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "watch_history_retention_idx" ON "watch_history" ("watched_at");--> statement-breakpoint
ALTER TABLE "audience_reactions" ADD CONSTRAINT "audience_reactions_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "audience_reactions" ADD CONSTRAINT "audience_reactions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "debater_follows" ADD CONSTRAINT "debater_follows_follower_user_id_users_id_fkey" FOREIGN KEY ("follower_user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "debater_follows" ADD CONSTRAINT "debater_follows_debater_actor_id_actors_id_fkey" FOREIGN KEY ("debater_actor_id") REFERENCES "actors"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "messaging_channels" ADD CONSTRAINT "messaging_channels_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_fanouts" ADD CONSTRAINT "notification_fanouts_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_debater_actor_id_actors_id_fkey" FOREIGN KEY ("debater_actor_id") REFERENCES "actors"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "watch_history" ADD CONSTRAINT "watch_history_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "watch_history" ADD CONSTRAINT "watch_history_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "messaging_channels" ADD CONSTRAINT "messaging_channels_round" CHECK (("kind" = 'round_spectator') = ("round_id" is not null));--> statement-breakpoint
ALTER TABLE "messaging_channels" DROP CONSTRAINT "messaging_channels_kind", ADD CONSTRAINT "messaging_channels_kind" CHECK ("kind" in ('dm', 'private_group', 'round_spectator'));--> statement-breakpoint
ALTER TABLE "messaging_channels" DROP CONSTRAINT "messaging_channels_policy", ADD CONSTRAINT "messaging_channels_policy" CHECK ("policy_revision" > 0 and (("kind" = 'dm' and "policy_key" = 'social.dm') or ("kind" = 'private_group' and "policy_key" = 'social.private_group') or ("kind" = 'round_spectator' and "policy_key" = 'round.spectator')));