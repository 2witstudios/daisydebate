ALTER TABLE "rounds" DROP CONSTRAINT "rounds_lifecycle_check", ADD CONSTRAINT "rounds_lifecycle_check" CHECK (("status" = 'scheduled' and "current_stage" is null and "outcome" is null and "started_at" is null and "completed_at" is null) or ("status" = 'active' and "current_stage" is not null and "outcome" is null and "started_at" is not null and "completed_at" is null) or ("status" = 'completed' and "current_stage" is null and ("outcome" is not null or ("competition_type" = 'casual' and "ladder_id" is null and coalesce("rules_snapshot" #> '{seats,judge}' = '0'::jsonb, false))) and "started_at" is not null and "completed_at" is not null) or ("status" = 'abandoned' and "current_stage" is null and "outcome" is null and "completed_at" is not null));--> statement-breakpoint
-- DEC-191: actual judge seats are cross-row facts, so a CHECK alone cannot
-- witness zero judges. Serialize deferred seat admission with Round completion;
-- the lock is separate from the fresh fact query to close concurrent insertion.
CREATE FUNCTION guard_unjudged_round_participants() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_round text;
BEGIN
  IF TG_TABLE_NAME = 'rounds' THEN
    target_round := NEW.id;
  ELSE
    target_round := NEW.round_id;
  END IF;
  PERFORM id FROM rounds WHERE id = target_round FOR NO KEY UPDATE;
  IF EXISTS (
    SELECT 1 FROM rounds r
    WHERE r.id = target_round AND r.status = 'completed' AND r.outcome IS NULL
      AND EXISTS (SELECT 1 FROM round_participants p WHERE p.round_id = r.id AND p.role = 'judge')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'rounds_unjudged_participants_check', MESSAGE = 'Unjudged completion cannot contain judge seats';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER rounds_unjudged_participants_check
AFTER INSERT OR UPDATE ON rounds DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (NEW.status = 'completed' AND NEW.outcome IS NULL)
EXECUTE FUNCTION guard_unjudged_round_participants();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER round_participants_unjudged_completion_check
AFTER INSERT OR UPDATE ON round_participants DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (NEW.role = 'judge')
EXECUTE FUNCTION guard_unjudged_round_participants();
