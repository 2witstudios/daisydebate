ALTER TABLE "rating_changes" ADD COLUMN "ladder" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "ladder" text;--> statement-breakpoint
ALTER TABLE "ratings" DROP CONSTRAINT "ratings_pkey";--> statement-breakpoint
ALTER TABLE "ratings" ADD PRIMARY KEY ("actor_id","format_id","season_id","ladder");--> statement-breakpoint
DROP INDEX "rating_changes_actor_format_occurred_idx";--> statement-breakpoint
CREATE INDEX "rating_changes_actor_format_occurred_idx" ON "rating_changes" ("actor_id","format_id","ladder","occurred_at");--> statement-breakpoint
DROP INDEX "ratings_leaderboard_idx";--> statement-breakpoint
CREATE INDEX "ratings_leaderboard_idx" ON "ratings" ("format_id","season_id","ladder","rating" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_ladder_check" CHECK ("ladder" in ('ranked', 'quick'));--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_ladder_check" CHECK ("ladder" in ('ranked', 'quick'));--> statement-breakpoint
ALTER TABLE "debates" DROP CONSTRAINT "debates_mode_check", ADD CONSTRAINT "debates_mode_check" CHECK ("mode" in ('casual', 'ranked', 'quick', 'practice'));