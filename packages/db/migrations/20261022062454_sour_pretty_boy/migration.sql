ALTER TABLE "utterances" DROP CONSTRAINT "utterances_participant_round_fk", ADD CONSTRAINT "utterances_participant_round_fk" FOREIGN KEY ("round_participant_id","round_id") REFERENCES "round_participants"("id","round_id");
--> statement-breakpoint
-- Utterances and seats are separate owning-Round cascade branches. Scoped
-- consistency is checked after both branches; direct seat deletion still fails.
ALTER TABLE utterances ALTER CONSTRAINT utterances_participant_round_fk DEFERRABLE INITIALLY DEFERRED;
