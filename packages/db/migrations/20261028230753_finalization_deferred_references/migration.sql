-- A Round owns its commands, freeze, ballots and finalization. Validate these
-- cross-child references at commit so deleting the aggregate has no cascade
-- ordering dependency. Direct deletion of referenced inputs still refuses.
ALTER TABLE round_finalizations ALTER CONSTRAINT round_finalizations_command_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE round_finalizations ALTER CONSTRAINT round_finalizations_freeze_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE round_finalization_ballots ALTER CONSTRAINT round_finalization_ballots_input_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE round_finalization_ballots ALTER CONSTRAINT round_finalization_ballots_membership_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE round_finalization_ballots ALTER CONSTRAINT round_finalization_ballots_ballot_id_ballots_id_fkey DEFERRABLE INITIALLY DEFERRED;
