ALTER TABLE "ballots" ADD COLUMN "round_id" text;--> statement-breakpoint
ALTER TABLE "ballots" ADD COLUMN "freeze_revision" integer;--> statement-breakpoint
CREATE INDEX "ballots_judge_round_idx" ON "ballots" ("judge_participant_id","round_id");--> statement-breakpoint
CREATE INDEX "ballots_freeze_revision_idx" ON "ballots" ("round_id","freeze_revision");--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_judge_round_fk" FOREIGN KEY ("judge_participant_id","round_id") REFERENCES "round_participants"("id","round_id");--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_freeze_revision_fk" FOREIGN KEY ("round_id","freeze_revision") REFERENCES "round_transcript_freezes"("round_id","revision");--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_freeze_pair_check" CHECK (("round_id" is null and "freeze_revision" is null) or ("round_id" is not null and "freeze_revision" is not null and "freeze_revision" > 0));--> statement-breakpoint
ALTER TABLE "round_commands" DROP CONSTRAINT "round_commands_type_check", ADD CONSTRAINT "round_commands_type_check" CHECK ("type" in ('start', 'start_prep', 'end_prep', 'start_speech', 'yield', 'interrupt', 'forfeit', 'complete', 'submit_ballot'));
--> statement-breakpoint
CREATE FUNCTION refuse_ballot_freeze_rewrite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.round_id IS DISTINCT FROM OLD.round_id OR
     NEW.freeze_revision IS DISTINCT FROM OLD.freeze_revision THEN
    RAISE EXCEPTION 'Frozen ballot provenance is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'ballots_freeze_immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ballots_freeze_immutable
BEFORE UPDATE ON ballots
FOR EACH ROW EXECUTE FUNCTION refuse_ballot_freeze_rewrite();
