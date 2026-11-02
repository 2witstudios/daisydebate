-- ADR 0096 backfill: cross-examination always opens every debater's microphone
-- and never has interruptions, so no stored format, Room or Round names a mode.
-- A stored cross_ex_only policy allowed only that interruption, so it is off.
UPDATE "format_revisions" SET "definition" = "definition" #- '{configurable,interaction,crossExModes}';--> statement-breakpoint
UPDATE "format_revisions" SET "definition" = jsonb_set("definition", '{configurable,interaction,interruptions,modes}', ("definition" #> '{configurable,interaction,interruptions,modes}') - 'cross_ex_only') WHERE jsonb_typeof("definition" #> '{configurable,interaction,interruptions}') = 'object';--> statement-breakpoint
UPDATE "format_presets" SET "config" = "config" - 'crossExamination';--> statement-breakpoint
UPDATE "format_presets" SET "config" = jsonb_set("config", '{interruptions,mode}', '"disabled"') WHERE "config" #>> '{interruptions,mode}' = 'cross_ex_only';--> statement-breakpoint
UPDATE "rooms" SET "config" = "config" - 'crossExamination';--> statement-breakpoint
UPDATE "rooms" SET "config" = jsonb_set("config", '{interruptions,mode}', '"disabled"') WHERE "config" #>> '{interruptions,mode}' = 'cross_ex_only';--> statement-breakpoint
UPDATE "rooms" SET "rules_snapshot" = "rules_snapshot" #- '{interaction,crossExMode}';--> statement-breakpoint
UPDATE "rooms" SET "rules_snapshot" = jsonb_set("rules_snapshot", '{interaction,interruptions,allowed}', '"disabled"') WHERE "rules_snapshot" #>> '{interaction,interruptions,allowed}' = 'cross_ex_only';--> statement-breakpoint
UPDATE "rounds" SET "room_config_snapshot" = "room_config_snapshot" - 'crossExamination' WHERE "room_config_snapshot" IS NOT NULL;--> statement-breakpoint
UPDATE "rounds" SET "room_config_snapshot" = jsonb_set("room_config_snapshot", '{interruptions,mode}', '"disabled"') WHERE "room_config_snapshot" #>> '{interruptions,mode}' = 'cross_ex_only';--> statement-breakpoint
UPDATE "rounds" SET "rules_snapshot" = "rules_snapshot" #- '{interaction,crossExMode}';--> statement-breakpoint
UPDATE "rounds" SET "rules_snapshot" = jsonb_set("rules_snapshot", '{interaction,interruptions,allowed}', '"disabled"') WHERE "rules_snapshot" #>> '{interaction,interruptions,allowed}' = 'cross_ex_only';
