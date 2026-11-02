ALTER TABLE "ballots" DROP CONSTRAINT "ballots_voided_by_actor_fk";--> statement-breakpoint
ALTER TABLE "ballots" DROP CONSTRAINT "ballots_voided_fields_check";--> statement-breakpoint
ALTER TABLE "ballots" DROP CONSTRAINT "ballots_voided_after_submitted";--> statement-breakpoint
DROP INDEX "ballots_voided_by_actor_idx";--> statement-breakpoint
-- No code ever wrote a voided ballot, so this touches no row on a real database. It runs first so one could not refuse the constraint below.
UPDATE "ballots" SET "status" = 'submitted' WHERE "status" <> 'submitted';--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "ballots" DROP COLUMN "voided_at";--> statement-breakpoint
ALTER TABLE "ballots" DROP COLUMN "voided_by_actor_id";--> statement-breakpoint
ALTER TABLE "ballots" DROP CONSTRAINT "ballots_status_check", ADD CONSTRAINT "ballots_status_check" CHECK ("status" in ('submitted'));--> statement-breakpoint
-- The guard fences a human judge's window (ISSUE-938). A Round completes without a winner only once every human judge has ruled or their deadline has passed; a null deadline stays not yet allowed (ISSUE-983).
ALTER TRIGGER "rounds_unjudged_participants_check" ON "rounds" RENAME TO "rounds_winnerless_completion_check";--> statement-breakpoint
ALTER TRIGGER "round_participants_unjudged_completion_check" ON "round_participants" RENAME TO "round_participants_winnerless_completion_check";--> statement-breakpoint
ALTER FUNCTION guard_unjudged_round_participants() RENAME TO guard_winnerless_round_completion;--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_winnerless_round_completion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_round text;
BEGIN
  IF TG_TABLE_NAME = 'rounds' THEN
    target_round := NEW.id;
  ELSE
    target_round := NEW.round_id;
  END IF;
  PERFORM id FROM rounds WHERE id = target_round FOR NO KEY UPDATE;
  IF EXISTS (
    SELECT 1 FROM rounds r
    WHERE r.id = target_round AND r.status = 'completed' AND r.outcome IS NULL
      AND EXISTS (
        SELECT 1 FROM round_participants p JOIN actors a ON a.id = p.actor_id
        WHERE p.round_id = r.id AND p.role = 'judge' AND a.kind = 'human'
          AND NOT EXISTS (SELECT 1 FROM ballots b WHERE b.judge_participant_id = p.id)
      )
      AND (r.ballot_deadline_at IS NULL OR clock_timestamp() < r.ballot_deadline_at)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'rounds_winnerless_completion_check', MESSAGE = 'A Round with a human judge completes without a winner only once every human judge has ruled or their deadline has passed';
  END IF;
  RETURN NEW;
END;
$$;
