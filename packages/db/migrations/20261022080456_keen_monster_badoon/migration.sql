ALTER TABLE "round_judging_jobs" ADD COLUMN "pending_ballot" jsonb;--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD COLUMN "pending_ballot_agent_run_id" text;--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD COLUMN "pending_ballot_epoch" integer;--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD COLUMN "pending_ballot_received_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "round_judging_jobs_pending_run_judge_idx" ON "round_judging_jobs" ("pending_ballot_agent_run_id","judge_participant_id");--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD CONSTRAINT "round_judging_jobs_pending_run_judge_fk" FOREIGN KEY ("pending_ballot_agent_run_id","judge_participant_id") REFERENCES "agent_runs"("id","round_participant_id");--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD CONSTRAINT "round_judging_jobs_pending_ballot_is_object" CHECK (jsonb_typeof("pending_ballot") = 'object');--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD CONSTRAINT "round_judging_jobs_pending_check" CHECK (("pending_ballot" is null and "pending_ballot_agent_run_id" is null and "pending_ballot_epoch" is null and "pending_ballot_received_at" is null) or ("pending_ballot" is not null and "pending_ballot_agent_run_id" is not null and "pending_ballot_epoch" is not null and "pending_ballot_epoch" > 0 and "pending_ballot_epoch" <= "attempts" and "pending_ballot_received_at" is not null and "status" <> 'succeeded'));--> statement-breakpoint
ALTER TABLE round_judging_jobs ALTER CONSTRAINT round_judging_jobs_pending_run_judge_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE FUNCTION guard_pending_judging_response() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.pending_ballot IS NOT NULL THEN
    IF NEW.pending_ballot IS NULL THEN
      IF NEW.status <> 'succeeded' OR NOT EXISTS (
        SELECT 1 FROM ballots WHERE id=NEW.result_ballot_id
          AND judge_participant_id=OLD.judge_participant_id
          AND round_id=OLD.round_id AND freeze_revision=OLD.freeze_revision
          AND status='submitted'
      ) THEN
        RAISE EXCEPTION 'A pending response clears only with its committed ballot'
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
--> statement-breakpoint
CREATE TRIGGER round_judging_jobs_pending_guard BEFORE UPDATE ON round_judging_jobs FOR EACH ROW EXECUTE FUNCTION guard_pending_judging_response();
