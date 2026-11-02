CREATE TABLE "round_judging_attempts" (
	"agent_run_id" text PRIMARY KEY,
	"round_id" text NOT NULL,
	"judge_participant_id" text NOT NULL,
	"job_epoch" integer NOT NULL,
	"model" text NOT NULL,
	"contract_version" text NOT NULL,
	"category" text NOT NULL,
	"diagnostic" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "round_judging_attempts_diagnostic_is_object" CHECK (jsonb_typeof("diagnostic") = 'object'),
	CONSTRAINT "round_judging_attempts_category_check" CHECK ("category" in ('invalid_json', 'schema_rejected', 'truncated', 'refused', 'provider_refused', 'provider_error', 'timeout', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD COLUMN "generation_deadline_at" timestamp with time zone;--> statement-breakpoint
UPDATE "round_judging_jobs" j SET "generation_deadline_at" = f."frozen_at" + interval '5 minutes' FROM "round_transcript_freezes" f WHERE f."round_id" = j."round_id" AND f."revision" = j."freeze_revision";--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ALTER COLUMN "generation_deadline_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD COLUMN "retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD COLUMN "terminal_reason" text;--> statement-breakpoint
CREATE INDEX "round_judging_attempts_job_idx" ON "round_judging_attempts" ("round_id","judge_participant_id");--> statement-breakpoint
CREATE INDEX "round_judging_attempts_run_judge_idx" ON "round_judging_attempts" ("agent_run_id","judge_participant_id");--> statement-breakpoint
ALTER TABLE "round_judging_attempts" ADD CONSTRAINT "round_judging_attempts_job_fk" FOREIGN KEY ("round_id","judge_participant_id") REFERENCES "round_judging_jobs"("round_id","judge_participant_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_judging_attempts" ADD CONSTRAINT "round_judging_attempts_run_judge_fk" FOREIGN KEY ("agent_run_id","judge_participant_id") REFERENCES "agent_runs"("id","round_participant_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD CONSTRAINT "round_judging_jobs_terminal_reason_check" CHECK ("terminal_reason" is null or ("status" = 'failed' and "terminal_reason" in ('attempts_exhausted', 'generation_deadline', 'round_ended')));