-- ISSUE-1409: submitted ballots are immutable; aggregate Round erasure still cascades.
CREATE FUNCTION refuse_submitted_ballot_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A submitted ballot is immutable'
    USING ERRCODE = '23514', CONSTRAINT = 'ballots_submission_immutable';
END;
$$;
--> statement-breakpoint
-- The existing freeze trigger runs first and preserves its provenance refusal.
CREATE TRIGGER ballots_submission_immutable BEFORE UPDATE ON ballots
FOR EACH ROW EXECUTE FUNCTION refuse_submitted_ballot_update();
--> statement-breakpoint
REVOKE UPDATE, DELETE ON ballots FROM daisy_web;
--> statement-breakpoint
-- JSONB supplies canonical key ordering; the submission instant is UTC-independent.
-- SHA-256 is PostgreSQL's built-in content hash, not a secret or token comparison.
CREATE FUNCTION daisy_ballot_content_digest(ballot ballots) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT encode(sha256(convert_to(jsonb_build_object(
    'digest_version', 1,
    'ballot_id', (ballot).id,
    'judge_participant_id', (ballot).judge_participant_id,
    'round_id', (ballot).round_id,
    'freeze_revision', (ballot).freeze_revision,
    'rubric_version', (ballot).rubric_version,
    'decision', (ballot).decision,
    'winner', (ballot).winner,
    'ranking', (ballot).ranking,
    'scores', (ballot).scores,
    'reason', (ballot).reason,
    'feedback', (ballot).feedback,
    'citations', (ballot).citations,
    'ballot_definition_id', (ballot).ballot_definition_id,
    'ballot_definition_version', (ballot).ballot_definition_version,
    'submitted_at_epoch_us', floor(extract(epoch FROM (ballot).submitted_at) * 1000000)
  )::text, 'UTF8')), 'hex')
$$;
--> statement-breakpoint
ALTER TABLE round_finalization_ballots ADD COLUMN ballot_digest text;
--> statement-breakpoint
-- Every path, including direct runtime SQL, pins the actual stored content.
CREATE FUNCTION pin_finalization_ballot_digest() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  SELECT daisy_ballot_content_digest(b) INTO NEW.ballot_digest
    FROM ballots b WHERE b.id = NEW.ballot_id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_finalization_ballot_digest BEFORE INSERT ON round_finalization_ballots
FOR EACH ROW EXECUTE FUNCTION pin_finalization_ballot_digest();
--> statement-breakpoint
-- The membership FK proves every source ballot exists. No payload is rewritten.
UPDATE round_finalization_ballots m SET ballot_digest = daisy_ballot_content_digest(b)
FROM ballots b WHERE b.id = m.ballot_id;
--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;
--> statement-breakpoint
ALTER TABLE round_finalization_ballots ALTER COLUMN ballot_digest SET NOT NULL;
--> statement-breakpoint
ALTER TABLE round_finalization_ballots ADD CONSTRAINT round_finalization_ballots_digest_check
CHECK (ballot_digest ~ '^[a-f0-9]{64}$') NOT VALID;
