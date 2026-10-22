ALTER TABLE "rounds" DROP CONSTRAINT "rounds_lifecycle_check", ADD CONSTRAINT "rounds_lifecycle_check" CHECK (("status" = 'scheduled' and "current_stage" is null and "outcome" is null and "started_at" is null and "completed_at" is null) or ("status" = 'active' and "current_stage" is not null and "outcome" is null and "started_at" is not null and "completed_at" is null) or ("status" = 'completed' and "current_stage" is null and ("outcome" is not null or ("competition_type" = 'casual' and "ladder_id" is null)) and "started_at" is not null and "completed_at" is not null) or ("status" = 'abandoned' and "current_stage" is null and "outcome" is null and "completed_at" is not null));--> statement-breakpoint
-- DEC-201 supersedes DEC-191's zero-judge witness: judges who do not rule by
-- the ballot deadline leave a judged casual Round completed without a winner.
DROP TRIGGER "rounds_unjudged_participants_check" ON "rounds";--> statement-breakpoint
DROP TRIGGER "round_participants_unjudged_completion_check" ON "round_participants";--> statement-breakpoint
DROP FUNCTION "guard_unjudged_round_participants"();
