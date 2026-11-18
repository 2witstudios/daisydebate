-- ADR 0147: a ladder is a style in a division. Every existing season,
-- rating, ledger row, ranked Round and ranked challenge is Open – Freestyle,
-- so each column is added with 'open' for the rows already there and then
-- loses its default: every later writer names the division. No rating value
-- is read or written. Nothing here can refuse: each backfill precedes the
-- constraint it satisfies. Setting a Round's division touches no judging, so
-- the migration owner suspends only the deferred judge-slot completion guard
-- for that one rewrite in this transaction: a historical completed Round with
-- an empty frozen slot must not block the release. SET CONSTRAINTS ALL
-- IMMEDIATE then runs any other queued events before later DDL.
ALTER TABLE "rating_changes" DROP CONSTRAINT "rating_changes_season_id_seasons_id_fkey";--> statement-breakpoint
ALTER TABLE "ratings" DROP CONSTRAINT "ratings_season_id_seasons_id_fkey";--> statement-breakpoint
ALTER TABLE "seasons" DROP CONSTRAINT "seasons_activation_key_key";--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "division" text;--> statement-breakpoint
ALTER TABLE "rating_changes" ADD COLUMN "division" text NOT NULL DEFAULT 'open';--> statement-breakpoint
ALTER TABLE "rating_changes" ALTER COLUMN "division" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "division" text NOT NULL DEFAULT 'open';--> statement-breakpoint
ALTER TABLE "ratings" ALTER COLUMN "division" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "division" text NOT NULL DEFAULT 'open';--> statement-breakpoint
ALTER TABLE "seasons" ALTER COLUMN "division" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "ladder_division" text;--> statement-breakpoint
ALTER TABLE "rounds" DISABLE TRIGGER "rounds_judge_slots_complete";--> statement-breakpoint
UPDATE "rounds" SET "ladder_division" = 'open' WHERE "ladder_id" IS NOT NULL;--> statement-breakpoint
UPDATE "challenges" SET "division" = 'open' WHERE "mode" = 'ranked';--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "rounds" ENABLE TRIGGER "rounds_judge_slots_complete";--> statement-breakpoint
DROP INDEX "seasons_single_active";--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_single_active" ON "seasons" ("organization_id","division") WHERE "status" = 'active';--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_id_division_unique" UNIQUE("id","division");--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_activation_key_division_unique" UNIQUE("activation_key","division");--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_id_ladder_division_unique" UNIQUE("id","ladder_division");--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_season_division_fk" FOREIGN KEY ("season_id","division") REFERENCES "seasons"("id","division") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_round_division_fk" FOREIGN KEY ("round_id","division") REFERENCES "rounds"("id","ladder_division") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_season_division_fk" FOREIGN KEY ("season_id","division") REFERENCES "seasons"("id","division") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_division_check" CHECK (("mode" = 'ranked') = ("division" is not null) and ("division" is null or "division" in ('open', 'youth')));--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_division_check" CHECK ("division" in ('open', 'youth'));--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_division_check" CHECK ("division" in ('open', 'youth'));--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_division_check" CHECK ("division" in ('open', 'youth'));--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_ladder_division_check" CHECK (("ladder_id" is null) = ("ladder_division" is null) and ("ladder_division" is null or "ladder_division" in ('open', 'youth')));--> statement-breakpoint
CREATE INDEX "rating_changes_season_division_idx" ON "rating_changes" ("season_id","division");--> statement-breakpoint
CREATE INDEX "rating_changes_round_division_idx" ON "rating_changes" ("round_id","division");--> statement-breakpoint
CREATE INDEX "ratings_season_division_idx" ON "ratings" ("season_id","division");
