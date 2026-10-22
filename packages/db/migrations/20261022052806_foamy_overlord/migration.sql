CREATE TABLE "round_judging_jobs" (
	"round_id" text PRIMARY KEY,
	"freeze_revision" integer NOT NULL,
	"judge_participant_id" text NOT NULL,
	"status" text NOT NULL,
	"lease_token" text,
	"lease_expires_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"result_ballot_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "round_judging_jobs_status_check" CHECK ("status" in ('queued', 'leased', 'succeeded', 'failed')),
	CONSTRAINT "round_judging_jobs_attempts_check" CHECK ("attempts" >= 0 and ("status" <> 'leased' or "attempts" > 0)),
	CONSTRAINT "round_judging_jobs_lease_check" CHECK (("status" = 'leased' and "lease_token" is not null and "lease_expires_at" is not null) or ("status" <> 'leased' and "lease_token" is null and "lease_expires_at" is null)),
	CONSTRAINT "round_judging_jobs_result_check" CHECK (("status" = 'succeeded') = ("result_ballot_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "round_transcript_freezes" (
	"round_id" text PRIMARY KEY,
	"revision" integer NOT NULL,
	"frontier" integer NOT NULL,
	"frozen_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"completeness" text NOT NULL,
	CONSTRAINT "round_transcript_freezes_revision_check" CHECK ("revision" > 0 and "frontier" >= 0),
	CONSTRAINT "round_transcript_freezes_completeness_check" CHECK ("completeness" in ('complete', 'incomplete'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ballots_id_judge_unique" ON "ballots" ("id","judge_participant_id");--> statement-breakpoint
CREATE INDEX "round_judging_jobs_judge_round_idx" ON "round_judging_jobs" ("judge_participant_id","round_id");--> statement-breakpoint
CREATE INDEX "round_judging_jobs_result_judge_idx" ON "round_judging_jobs" ("result_ballot_id","judge_participant_id");--> statement-breakpoint
CREATE INDEX "round_judging_jobs_pending_idx" ON "round_judging_jobs" ("status","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "round_transcript_freezes_round_revision_unique" ON "round_transcript_freezes" ("round_id","revision");--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD CONSTRAINT "round_judging_jobs_freeze_revision_fk" FOREIGN KEY ("round_id","freeze_revision") REFERENCES "round_transcript_freezes"("round_id","revision") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD CONSTRAINT "round_judging_jobs_judge_round_fk" FOREIGN KEY ("judge_participant_id","round_id") REFERENCES "round_participants"("id","round_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD CONSTRAINT "round_judging_jobs_result_judge_fk" FOREIGN KEY ("result_ballot_id","judge_participant_id") REFERENCES "ballots"("id","judge_participant_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "round_transcript_freezes" ADD CONSTRAINT "round_transcript_freezes_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_speaking_intervals" DROP CONSTRAINT "round_speaking_intervals_time_check", ADD CONSTRAINT "round_speaking_intervals_time_check" CHECK ("ended_at" is null or "ended_at" >= "started_at");
--> statement-breakpoint
CREATE FUNCTION refuse_round_transcript_freeze_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A transcript freeze is immutable'
    USING ERRCODE = '23514', CONSTRAINT = 'round_transcript_freezes_immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_transcript_freezes_immutable
BEFORE UPDATE ON round_transcript_freezes
FOR EACH ROW EXECUTE FUNCTION refuse_round_transcript_freeze_update();
