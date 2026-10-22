-- Scoped references cross multiple Round-owned cascade branches. Check them at
-- transaction end, after every owned branch is gone; direct deletions still fail.
ALTER TABLE media_participants ALTER CONSTRAINT media_participants_participant_round_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE round_speaking_intervals ALTER CONSTRAINT round_speaking_intervals_participant_round_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE round_speaking_intervals ALTER CONSTRAINT round_speaking_intervals_started_command_round_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE round_speaking_intervals ALTER CONSTRAINT round_speaking_intervals_ended_command_round_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE round_judging_jobs ALTER CONSTRAINT round_judging_jobs_judge_round_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE round_judging_jobs ALTER CONSTRAINT round_judging_jobs_result_judge_fk DEFERRABLE INITIALLY DEFERRED;
