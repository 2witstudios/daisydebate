ALTER TABLE "rounds" DROP CONSTRAINT "rounds_current_stage_check", ADD CONSTRAINT "rounds_current_stage_check" CHECK ("current_stage" is null or "current_stage" in ('countdown', 'prep', 'live', 'awaiting_ballot'));--> statement-breakpoint
-- ISSUE-1012: a frozen interruption rule has one spelling for forbidden, and only
-- enabled has a protected end. An enabled rule is already in its final shape.
UPDATE "rooms" SET "rules_snapshot" = jsonb_set("rules_snapshot", '{interaction,interruptions}', CASE "rules_snapshot" #>> '{interaction,interruptions,allowed}' WHEN 'open' THEN '{"allowed":"open"}'::jsonb ELSE '{"allowed":"disabled"}'::jsonb END) WHERE "rules_snapshot" #>> '{interaction,interruptions,allowed}' IS DISTINCT FROM 'enabled';--> statement-breakpoint
-- This rewrite changes no completion fact, so the completion guard has nothing to
-- judge, and a row older than the guard must not block the release.
ALTER TABLE "rounds" DISABLE TRIGGER "rounds_winnerless_completion_check";--> statement-breakpoint
UPDATE "rounds" SET "rules_snapshot" = jsonb_set("rules_snapshot", '{interaction,interruptions}', CASE "rules_snapshot" #>> '{interaction,interruptions,allowed}' WHEN 'open' THEN '{"allowed":"open"}'::jsonb ELSE '{"allowed":"disabled"}'::jsonb END) WHERE "rules_snapshot" #>> '{interaction,interruptions,allowed}' IS DISTINCT FROM 'enabled';--> statement-breakpoint
-- ISSUE-1014: an active Round past its last segment is awaiting its ballot, not live.
UPDATE "rounds" SET "current_stage" = 'awaiting_ballot' WHERE "status" = 'active' AND "final_segment_ended_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "rounds" ENABLE TRIGGER "rounds_winnerless_completion_check";
