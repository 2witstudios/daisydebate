-- The migration runner must execute this folder and its ledger row atomically.
-- Hold out DML through preflight and trigger replacement; session DDL waits are bounded.
LOCK TABLE rounds, round_transcripts, round_transcript_freezes, utterances IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
DO $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Transcript guard installation requires READ COMMITTED isolation'
      USING ERRCODE = '23514', CONSTRAINT = 'transcript_write_isolation_check';
  END IF;
  IF EXISTS (
    SELECT 1 FROM round_transcript_freezes z
    LEFT JOIN round_transcripts t ON t.round_id = z.round_id
    WHERE z.frontier <> COALESCE(t.revision, 0)
  ) THEN
    RAISE EXCEPTION 'Existing frozen frontier mismatch requires an adjudicated repair'
      USING ERRCODE = '23514', CONSTRAINT = 'round_transcript_freezes_frontier_check';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION require_transcript_write_isolation() RETURNS void LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Transcript writes require READ COMMITTED isolation'
      USING ERRCODE = '23514', CONSTRAINT = 'transcript_write_isolation_check';
  END IF;
END;
$$;
--> statement-breakpoint
DROP TRIGGER round_transcript_freezes_immutable ON round_transcript_freezes;
--> statement-breakpoint
DROP FUNCTION refuse_round_transcript_freeze_update();
--> statement-breakpoint
CREATE FUNCTION guard_round_transcript_freeze() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
DECLARE current_frontier integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM require_transcript_write_isolation();
    PERFORM id FROM rounds WHERE id = NEW.round_id FOR NO KEY UPDATE;
    SELECT COALESCE((SELECT revision FROM round_transcripts WHERE round_id = NEW.round_id), 0)
      INTO current_frontier;
    IF NEW.frontier <> current_frontier THEN
      RAISE EXCEPTION 'Transcript freeze must match its durable frontier'
        USING ERRCODE = '23514', CONSTRAINT = 'round_transcript_freezes_frontier_check';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM rounds WHERE id = OLD.round_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'A transcript freeze is immutable'
    USING ERRCODE = '23514', CONSTRAINT = 'round_transcript_freezes_immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_transcript_freezes_immutable
BEFORE INSERT OR UPDATE OR DELETE ON round_transcript_freezes
FOR EACH ROW EXECUTE FUNCTION guard_round_transcript_freeze();
--> statement-breakpoint
CREATE FUNCTION guard_frozen_utterance_write() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
DECLARE target_rounds text[];
BEGIN
  PERFORM require_transcript_write_isolation();
  target_rounds := ARRAY[NEW.round_id];
  IF TG_OP = 'UPDATE' THEN
    target_rounds := ARRAY[OLD.round_id, NEW.round_id];
  END IF;
  PERFORM id FROM rounds WHERE id = ANY(target_rounds) ORDER BY id FOR NO KEY UPDATE;
  -- READ COMMITTED plus this separate query observes a freeze committed during the lock wait.
  IF EXISTS (SELECT 1 FROM round_transcript_freezes WHERE round_id = ANY(target_rounds)) THEN
    RAISE EXCEPTION 'Frozen transcript text cannot be written'
      USING ERRCODE = '23514', CONSTRAINT = 'utterances_frozen_transcript_check';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER utterances_frozen_transcript_check
BEFORE INSERT OR UPDATE ON utterances
FOR EACH ROW EXECUTE FUNCTION guard_frozen_utterance_write();
--> statement-breakpoint
CREATE FUNCTION guard_frozen_transcript_counter() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
DECLARE target_rounds text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM rounds WHERE id = OLD.round_id) THEN
      RETURN OLD;
    END IF;
    target_rounds := ARRAY[OLD.round_id];
  ELSE
    target_rounds := ARRAY[NEW.round_id];
    IF TG_OP = 'UPDATE' THEN
      target_rounds := ARRAY[OLD.round_id, NEW.round_id];
    END IF;
  END IF;
  PERFORM require_transcript_write_isolation();
  PERFORM id FROM rounds WHERE id = ANY(target_rounds) ORDER BY id FOR NO KEY UPDATE;
  IF EXISTS (SELECT 1 FROM round_transcript_freezes WHERE round_id = ANY(target_rounds)) THEN
    RAISE EXCEPTION 'Frozen transcript frontier cannot be written'
      USING ERRCODE = '23514', CONSTRAINT = 'round_transcripts_frozen_check';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_transcripts_frozen_check
BEFORE INSERT OR UPDATE OR DELETE ON round_transcripts
FOR EACH ROW EXECUTE FUNCTION guard_frozen_transcript_counter();
