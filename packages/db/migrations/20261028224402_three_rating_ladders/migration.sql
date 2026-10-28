-- No product-defined mapping exists for the abandoned generic pool. Refuse
-- populated state without modifying or deleting competitive truth.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM ratings) OR EXISTS (SELECT 1 FROM rating_changes)
     OR EXISTS (SELECT 1 FROM rounds WHERE ladder_id IS NOT NULL OR competition_type='ranked' OR preset_version IS NOT NULL)
     OR EXISTS (SELECT 1 FROM rooms WHERE competition_type='ranked' OR preset_version IS NOT NULL)
  THEN RAISE EXCEPTION 'Three ladders requires explicit disposition of existing rated state';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "ratings" DROP CONSTRAINT "ratings_format_id_formats_id_fkey";--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "activation_key" text;--> statement-breakpoint
DROP INDEX "ratings_leaderboard_idx";--> statement-breakpoint
ALTER TABLE "ratings" DROP COLUMN "format_id";--> statement-breakpoint
ALTER TABLE "ratings" ADD PRIMARY KEY ("actor_id","ladder","season_id");--> statement-breakpoint
CREATE INDEX "ratings_leaderboard_idx" ON "ratings" ("season_id","ladder","rating" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_activation_key_key" UNIQUE("activation_key");--> statement-breakpoint
ALTER TABLE "rating_changes" DROP CONSTRAINT "rating_changes_ladder_check", ADD CONSTRAINT "rating_changes_ladder_check" CHECK ("ladder" in ('freestyle', 'policy', 'value'));--> statement-breakpoint
ALTER TABLE "ratings" DROP CONSTRAINT "ratings_ladder_check", ADD CONSTRAINT "ratings_ladder_check" CHECK ("ladder" in ('freestyle', 'policy', 'value'));--> statement-breakpoint
ALTER TABLE "rounds" DROP CONSTRAINT "rounds_ladder_check", ADD CONSTRAINT "rounds_ladder_check" CHECK ("ladder_id" is null or "ladder_id" in ('freestyle', 'policy', 'value'));--> statement-breakpoint
ALTER TABLE "rounds" DROP CONSTRAINT "rounds_rated_ladder_check", ADD CONSTRAINT "rounds_rated_ladder_check" CHECK (("competition_type" = 'ranked' and "ladder_id" is not null and "ladder_id" = "format_id") or ("competition_type" <> 'ranked' and "ladder_id" is null));
--> statement-breakpoint
UPDATE format_presets SET ranked_eligible=false WHERE format_id NOT IN ('freestyle','policy','value');
--> statement-breakpoint
UPDATE format_presets SET ranked_eligible=true WHERE format_id IN ('freestyle','policy','value') AND superseded_at IS NULL;
