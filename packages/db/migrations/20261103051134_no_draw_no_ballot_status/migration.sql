-- ISSUE-1080: a ballot exists or it does not. The guard read a column with one value.
CREATE OR REPLACE FUNCTION guard_pending_judging_response() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.pending_ballot IS NOT NULL THEN
    IF NEW.pending_ballot IS NULL THEN
      IF NOT (NEW.status = 'failed' AND OLD.status <> 'succeeded') AND (NEW.status <> 'succeeded' OR NOT EXISTS (
        SELECT 1 FROM ballots WHERE id=NEW.result_ballot_id
          AND judge_participant_id=OLD.judge_participant_id
          AND round_id=OLD.round_id AND freeze_revision=OLD.freeze_revision
      )) THEN
        RAISE EXCEPTION 'A pending response clears only with its committed ballot or its failed job'
          USING ERRCODE='23514', CONSTRAINT='round_judging_jobs_pending_immutable';
      END IF;
    ELSIF ROW(NEW.pending_ballot,NEW.pending_ballot_agent_run_id,NEW.pending_ballot_epoch,NEW.pending_ballot_received_at)
      IS DISTINCT FROM ROW(OLD.pending_ballot,OLD.pending_ballot_agent_run_id,OLD.pending_ballot_epoch,OLD.pending_ballot_received_at) THEN
      RAISE EXCEPTION 'Pending response provenance is immutable across takeover'
        USING ERRCODE='23514', CONSTRAINT='round_judging_jobs_pending_immutable';
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
-- ISSUE-1027: a tie has no outcome (DEC-277), so a stored draw becomes the null it now
-- is, in the Round and its receipts, and a tie rates nothing, so its postings go.
-- A stored draw had every judge ruling, so the guard has nothing to refuse, and an
-- old row must not block the release.
ALTER TABLE "rounds" DISABLE TRIGGER "rounds_winnerless_completion_check";--> statement-breakpoint
DELETE FROM "rating_changes" WHERE "round_id" IN (SELECT "id" FROM "rounds" WHERE "outcome" = 'draw');--> statement-breakpoint
UPDATE "round_commands" SET "result" = jsonb_set("result", '{outcome}', 'null') WHERE "result"->>'outcome' = 'draw' AND "round_id" IN (SELECT "id" FROM "rounds" WHERE "outcome" = 'draw');--> statement-breakpoint
UPDATE "rounds" SET "outcome" = NULL WHERE "outcome" = 'draw';--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "rounds" ENABLE TRIGGER "rounds_winnerless_completion_check";--> statement-breakpoint
ALTER TABLE "ballots" DROP CONSTRAINT "ballots_status_check";--> statement-breakpoint
ALTER TABLE "ballots" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "rounds" DROP CONSTRAINT "rounds_outcome_check", ADD CONSTRAINT "rounds_outcome_check" CHECK ("outcome" is null or "outcome" in ('affirmative', 'negative'));