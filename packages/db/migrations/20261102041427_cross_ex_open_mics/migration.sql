-- ADR 0096 backfill: cross-examination always opens every debater's microphone
-- and never has interruptions, so no stored format, Room or Round names a mode.
-- A stored cross_ex_only policy allowed only that interruption, so it is off.
-- The lock makes a Round starting on the serving release wait for this commit.
LOCK TABLE "rounds" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "rounds" WHERE "status" = 'active') THEN
    RAISE EXCEPTION 'ADR 0096: wait for active Rounds to finish, then retry this release';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "format_revisions"
    WHERE "definition" #> '{configurable,interaction,interruptions,modes}' ? 'cross_ex_only'
      AND NOT "definition" #> '{configurable,interaction,interruptions,modes}' ? 'disabled'
  ) THEN
    RAISE EXCEPTION 'ADR 0096: a format revision permits cross_ex_only but not disabled';
  END IF;
END $$;--> statement-breakpoint
UPDATE "format_revisions" SET "definition" = "definition" #- '{configurable,interaction,crossExModes}' WHERE "definition" #> '{configurable,interaction}' ? 'crossExModes';--> statement-breakpoint
UPDATE "format_revisions" SET "definition" = jsonb_set("definition", '{configurable,interaction,interruptions,modes}', ("definition" #> '{configurable,interaction,interruptions,modes}') - 'cross_ex_only') WHERE "definition" #> '{configurable,interaction,interruptions,modes}' ? 'cross_ex_only';--> statement-breakpoint
UPDATE "format_presets" SET "config" = "config" - 'crossExamination' WHERE "config" ? 'crossExamination';--> statement-breakpoint
UPDATE "format_presets" SET "config" = jsonb_set("config", '{interruptions,mode}', '"disabled"') WHERE "config" #>> '{interruptions,mode}' = 'cross_ex_only';--> statement-breakpoint
UPDATE "rooms" SET "config" = "config" - 'crossExamination' WHERE "config" ? 'crossExamination';--> statement-breakpoint
UPDATE "rooms" SET "config" = jsonb_set("config", '{interruptions,mode}', '"disabled"') WHERE "config" #>> '{interruptions,mode}' = 'cross_ex_only';--> statement-breakpoint
UPDATE "rooms" SET "rules_snapshot" = "rules_snapshot" #- '{interaction,crossExMode}' WHERE "rules_snapshot" -> 'interaction' ? 'crossExMode';--> statement-breakpoint
UPDATE "rooms" SET "rules_snapshot" = jsonb_set("rules_snapshot", '{interaction,interruptions,allowed}', '"disabled"') WHERE "rules_snapshot" #>> '{interaction,interruptions,allowed}' = 'cross_ex_only';--> statement-breakpoint
UPDATE "rounds" SET "room_config_snapshot" = "room_config_snapshot" - 'crossExamination' WHERE "room_config_snapshot" ? 'crossExamination';--> statement-breakpoint
UPDATE "rounds" SET "room_config_snapshot" = jsonb_set("room_config_snapshot", '{interruptions,mode}', '"disabled"') WHERE "room_config_snapshot" #>> '{interruptions,mode}' = 'cross_ex_only';--> statement-breakpoint
UPDATE "rounds" SET "rules_snapshot" = "rules_snapshot" #- '{interaction,crossExMode}' WHERE "rules_snapshot" -> 'interaction' ? 'crossExMode';--> statement-breakpoint
UPDATE "rounds" SET "rules_snapshot" = jsonb_set("rules_snapshot", '{interaction,interruptions,allowed}', '"disabled"') WHERE "rules_snapshot" #>> '{interaction,interruptions,allowed}' = 'cross_ex_only';
