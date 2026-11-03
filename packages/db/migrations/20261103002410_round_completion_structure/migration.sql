-- Backfill first: a row the old schema allowed must not refuse this deploy.
UPDATE "rounds" SET "attendance_resolution_cutoff_at" = "final_segment_ended_at" + interval '60 minutes' WHERE "final_segment_ended_at" IS NOT NULL AND "attendance_resolution_cutoff_at" IS DISTINCT FROM "final_segment_ended_at" + interval '60 minutes';--> statement-breakpoint
UPDATE "rounds" SET "attendance_resolution_cutoff_at" = NULL WHERE "final_segment_ended_at" IS NULL AND "attendance_resolution_cutoff_at" IS NOT NULL;--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_attendance_cutoff_check" CHECK (("final_segment_ended_at" is null and "attendance_resolution_cutoff_at" is null) or ("final_segment_ended_at" is not null and "attendance_resolution_cutoff_at" is not null and "attendance_resolution_cutoff_at" = "final_segment_ended_at" + interval '60 minutes'));--> statement-breakpoint
-- Every data step runs before the constraint it satisfies, so nothing can refuse this deploy.
-- A failed job with no reason predates terminal reasons. Stored rows cannot tell an old retention or erasure discard from a Round ending, so those read round_ended.
UPDATE "round_judging_jobs" j SET "terminal_reason" = CASE WHEN (
    SELECT count(*) FROM "agent_runs" a
    WHERE a."round_participant_id" = j."judge_participant_id" AND a."kind" = 'judging'
      AND a."configuration_snapshot"->>'providerOutcome' IN ('unknown', 'received')
  ) >= 2 THEN 'attempts_exhausted' ELSE 'round_ended' END
WHERE j."status" = 'failed' AND j."terminal_reason" IS NULL;--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "round_judging_attempts" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "round_judging_attempts" ADD COLUMN "answered_at" timestamp with time zone;--> statement-breakpoint
UPDATE "round_judging_attempts" SET "outcome" = 'failed';--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "round_judging_attempts" ALTER COLUMN "category" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "round_judging_attempts" ALTER COLUMN "diagnostic" DROP NOT NULL;--> statement-breakpoint
-- The dispatches only the run snapshot recorded: a success, or a call lost to a crash.
INSERT INTO "round_judging_attempts" ("agent_run_id","round_id","judge_participant_id","job_epoch","model","contract_version","outcome")
SELECT a."id", j."round_id", j."judge_participant_id",
  coalesce((a."configuration_snapshot"->>'jobEpoch')::integer, j."attempts"),
  coalesce(a."model", j."model", 'unrecorded'), 'unrecorded',
  CASE WHEN j."pending_ballot_agent_run_id" = a."id" OR j."status" = 'succeeded' THEN 'succeeded' ELSE 'dispatched' END
FROM "agent_runs" a JOIN "round_judging_jobs" j ON j."judge_participant_id" = a."round_participant_id"
WHERE a."kind" = 'judging' AND a."configuration_snapshot"->>'providerOutcome' IN ('unknown', 'received')
  AND NOT EXISTS (SELECT 1 FROM "round_judging_attempts" t WHERE t."agent_run_id" = a."id");--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
UPDATE "round_judging_attempts" t SET "answered_at" = t."created_at"
FROM "agent_runs" a WHERE a."id" = t."agent_run_id" AND a."configuration_snapshot"->>'providerOutcome' = 'received';--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "round_judging_attempts" ALTER COLUMN "outcome" SET NOT NULL;--> statement-breakpoint
UPDATE "agent_runs" SET "configuration_snapshot" = "configuration_snapshot" - 'providerOutcome' WHERE "kind" = 'judging';--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ALTER COLUMN "generation_deadline_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "round_judging_attempts" DROP CONSTRAINT "round_judging_attempts_category_check", ADD CONSTRAINT "round_judging_attempts_category_check" CHECK ("category" is null or "category" in ('invalid_json', 'schema_rejected', 'truncated', 'refused', 'provider_refused', 'provider_error', 'timeout'));--> statement-breakpoint
ALTER TABLE "round_judging_attempts" ADD CONSTRAINT "round_judging_attempts_outcome_check" CHECK ("outcome" in ('dispatched', 'succeeded', 'failed') and ("outcome" = 'failed') = ("category" is not null) and ("category" is null) = ("diagnostic" is null));--> statement-breakpoint
ALTER TABLE "round_judging_jobs" DROP CONSTRAINT "round_judging_jobs_terminal_reason_check", ADD CONSTRAINT "round_judging_jobs_terminal_reason_check" CHECK (("status" = 'failed') = ("terminal_reason" is not null) and ("terminal_reason" is null or "terminal_reason" in ('attempts_exhausted', 'ballot_discarded', 'ballot_hold_ended', 'generation_deadline', 'provider_refused', 'round_ended')));--> statement-breakpoint
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
$$;--> statement-breakpoint
ALTER TABLE "round_attendance_adjudications" ALTER COLUMN "evidence" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "round_attendance_adjudications" DROP CONSTRAINT "round_attendance_adjudications_evidence_check";--> statement-breakpoint
-- One name for the ending (ISSUE-988). The row is immutable to the app; only this rename may touch it, before the new constraint.
ALTER TABLE "round_attendance_adjudications" DISABLE TRIGGER "round_attendance_adjudications_immutable";--> statement-breakpoint
UPDATE "round_attendance_adjudications" SET "evidence" = 'resolution_cutoff' WHERE "evidence" = 'infrastructure_unresolved';--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "round_attendance_adjudications" ENABLE TRIGGER "round_attendance_adjudications_immutable";--> statement-breakpoint
ALTER TABLE "round_attendance_adjudications" ADD CONSTRAINT "round_attendance_adjudications_evidence_check" CHECK (("evidence" = 'settled_availability' and "effective_deadline" is not null and "settled_horizon" is not null and "receipt_participant_id" is null)
        or ("evidence" = 'on_time_receipt' and "decision" = 'attended' and "effective_deadline" is null and "settled_horizon" is null and "receipt_participant_id" is not null)
        or ("evidence" = 'resolution_cutoff' and "decision" = 'abandoned' and "effective_deadline" is null and "settled_horizon" is null and "receipt_participant_id" is null));
