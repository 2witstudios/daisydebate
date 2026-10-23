ALTER TABLE "rounds" ADD COLUMN "ballot_deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rounds" DROP CONSTRAINT "rounds_lifecycle_check", ADD CONSTRAINT "rounds_lifecycle_check" CHECK (("status" = 'scheduled' and "current_stage" is null and "outcome" is null and "started_at" is null and "completed_at" is null) or ("status" = 'active' and "current_stage" is not null and "outcome" is null and "started_at" is not null and "completed_at" is null) or ("status" = 'completed' and "current_stage" is null and ("outcome" is not null or ("competition_type" = 'casual' and "ladder_id" is null)) and "started_at" is not null and "completed_at" is not null) or ("status" = 'abandoned' and "current_stage" is null and "outcome" is null and "completed_at" is not null));--> statement-breakpoint
-- DEC-201/DEC-207: a Round with judge seats may complete without a winner only
-- once the database clock at commit reaches the ballot deadline persisted at
-- its freeze, never by a writer-supplied completed_at; a zero-judge Round keeps
-- DEC-191's guarantee. The same deferred triggers fence both rows.
CREATE OR REPLACE FUNCTION guard_unjudged_round_participants() RETURNS trigger LANGUAGE plpgsql AS $$
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
      AND (r.ballot_deadline_at IS NULL OR clock_timestamp() < r.ballot_deadline_at)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'rounds_unjudged_participants_check', MESSAGE = 'A judged Round completes without a winner only at its ballot deadline';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION guard_round_ballot_deadline() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.ballot_deadline_at IS NOT NULL AND NEW.ballot_deadline_at IS DISTINCT FROM OLD.ballot_deadline_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'rounds_ballot_deadline_immutable', MESSAGE = 'A persisted ballot deadline is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER rounds_ballot_deadline_immutable BEFORE UPDATE ON rounds
FOR EACH ROW EXECUTE FUNCTION guard_round_ballot_deadline();
