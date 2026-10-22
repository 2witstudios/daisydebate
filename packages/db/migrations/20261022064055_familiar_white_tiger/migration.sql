ALTER TABLE "round_judging_jobs" ADD COLUMN "command_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "round_judging_jobs_command_unique" ON "round_judging_jobs" ("command_id");
--> statement-breakpoint
CREATE FUNCTION refuse_judging_intent_rewrite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.round_id IS DISTINCT FROM OLD.round_id OR
     NEW.judge_participant_id IS DISTINCT FROM OLD.judge_participant_id OR
     NEW.freeze_revision IS DISTINCT FROM OLD.freeze_revision THEN
    RAISE EXCEPTION 'A judging intent has immutable identity'
      USING ERRCODE = '23514', CONSTRAINT = 'round_judging_jobs_identity_immutable';
  END IF;
  IF OLD.command_id IS NOT NULL AND NEW.command_id IS DISTINCT FROM OLD.command_id THEN
    RAISE EXCEPTION 'A judging command identifier is allocated once'
      USING ERRCODE = '23514', CONSTRAINT = 'round_judging_jobs_command_immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_judging_jobs_identity_immutable
BEFORE UPDATE ON round_judging_jobs
FOR EACH ROW EXECUTE FUNCTION refuse_judging_intent_rewrite();
