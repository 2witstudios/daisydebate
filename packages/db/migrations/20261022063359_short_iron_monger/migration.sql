ALTER TABLE "round_judging_jobs" DROP CONSTRAINT "round_judging_jobs_pkey";--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD PRIMARY KEY ("round_id","judge_participant_id");--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_round_fk" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;
--> statement-breakpoint
-- Separate owning-Round cascades may delete seats before ballots. Standalone
-- seat/freeze deletion still fails at commit; only owning Round erasure cascades.
ALTER TABLE ballots ALTER CONSTRAINT ballots_judge_seat_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE ballots ALTER CONSTRAINT ballots_judge_round_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE ballots ALTER CONSTRAINT ballots_freeze_revision_fk DEFERRABLE INITIALLY DEFERRED;
