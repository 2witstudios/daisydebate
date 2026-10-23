CREATE INDEX "utterances_created_at_idx" ON "utterances" ("created_at");--> statement-breakpoint
-- DEC-223 (ISSUE-498): retention and subject erasure discard a pending response
-- by ending its job 'failed', the terminal state, with the whole tuple cleared.
CREATE OR REPLACE FUNCTION guard_pending_judging_response() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.pending_ballot IS NOT NULL THEN
    IF NEW.pending_ballot IS NULL THEN
      IF NOT (NEW.status = 'failed' AND OLD.status <> 'succeeded') AND (NEW.status <> 'succeeded' OR NOT EXISTS (
        SELECT 1 FROM ballots WHERE id=NEW.result_ballot_id
          AND judge_participant_id=OLD.judge_participant_id
          AND round_id=OLD.round_id AND freeze_revision=OLD.freeze_revision
          AND status='submitted'
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
END $$;
