ALTER TABLE "round_judging_attempts" ADD COLUMN "stage" text DEFAULT 'final' NOT NULL;--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD COLUMN "first_ballot" jsonb;--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD COLUMN "first_ballot_received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD COLUMN "first_ballot_failed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD COLUMN "case_map" jsonb;--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD COLUMN "case_map_received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "round_judging_attempts" ADD CONSTRAINT "round_judging_attempts_stage_check" CHECK ("stage" in ('first', 'map', 'final'));--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD CONSTRAINT "round_judging_jobs_first_ballot_is_object" CHECK (jsonb_typeof("first_ballot") = 'object');--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD CONSTRAINT "round_judging_jobs_case_map_is_object" CHECK (jsonb_typeof("case_map") = 'object');--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD CONSTRAINT "round_judging_jobs_first_ballot_check" CHECK (("first_ballot" is null) = ("first_ballot_received_at" is null) and not ("first_ballot" is not null and "first_ballot_failed"));--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD CONSTRAINT "round_judging_jobs_case_map_check" CHECK (("case_map" is null) = ("case_map_received_at" is null));--> statement-breakpoint
ALTER TABLE "ballots" DROP CONSTRAINT "ballots_rubric_version_check", ADD CONSTRAINT "ballots_rubric_version_check" CHECK ("rubric_version" in ('speaker-10@1', 'speaker-10@2'));