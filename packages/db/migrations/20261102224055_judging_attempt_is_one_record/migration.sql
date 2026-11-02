-- Every data step runs before the constraint it satisfies, so nothing can refuse this deploy.
-- A failed job with no reason predates terminal reasons. Stored rows cannot tell an old retention or erasure discard from a Round ending, so those read round_ended.
UPDATE "round_judging_jobs" j SET "terminal_reason" = CASE WHEN (
    SELECT count(*) FROM "agent_runs" a
    WHERE a."round_participant_id" = j."judge_participant_id" AND a."kind" = 'judging'
      AND a."configuration_snapshot"->>'providerOutcome' IN ('unknown', 'received')
  ) >= 2 THEN 'attempts_exhausted' ELSE 'round_ended' END
WHERE j."status" = 'failed' AND j."terminal_reason" IS NULL;--> statement-breakpoint
ALTER TABLE "round_judging_attempts" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "round_judging_attempts" ADD COLUMN "answered_at" timestamp with time zone;--> statement-breakpoint
UPDATE "round_judging_attempts" SET "outcome" = 'failed';--> statement-breakpoint
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
UPDATE "round_judging_attempts" t SET "answered_at" = t."created_at"
FROM "agent_runs" a WHERE a."id" = t."agent_run_id" AND a."configuration_snapshot"->>'providerOutcome' = 'received';--> statement-breakpoint
ALTER TABLE "round_judging_attempts" ALTER COLUMN "outcome" SET NOT NULL;--> statement-breakpoint
UPDATE "agent_runs" SET "configuration_snapshot" = "configuration_snapshot" - 'providerOutcome' WHERE "kind" = 'judging';--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ALTER COLUMN "generation_deadline_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "round_judging_attempts" DROP CONSTRAINT "round_judging_attempts_category_check", ADD CONSTRAINT "round_judging_attempts_category_check" CHECK ("category" is null or "category" in ('invalid_json', 'schema_rejected', 'truncated', 'refused', 'provider_refused', 'provider_error', 'timeout'));--> statement-breakpoint
ALTER TABLE "round_judging_attempts" ADD CONSTRAINT "round_judging_attempts_outcome_check" CHECK ("outcome" in ('dispatched', 'succeeded', 'failed') and ("outcome" = 'failed') = ("category" is not null) and ("category" is null) = ("diagnostic" is null));--> statement-breakpoint
ALTER TABLE "round_judging_jobs" DROP CONSTRAINT "round_judging_jobs_terminal_reason_check", ADD CONSTRAINT "round_judging_jobs_terminal_reason_check" CHECK (("status" = 'failed') = ("terminal_reason" is not null) and ("terminal_reason" is null or "terminal_reason" in ('attempts_exhausted', 'ballot_discarded', 'ballot_hold_ended', 'generation_deadline', 'provider_refused', 'round_ended')));
