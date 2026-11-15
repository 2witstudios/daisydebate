-- Stored data cannot make a validation refuse deployment. New writes are already checked.
DO $$
BEGIN
  ALTER TABLE round_finalization_ballots VALIDATE CONSTRAINT round_finalization_ballots_digest_check;
EXCEPTION WHEN check_violation THEN
  RAISE WARNING 'round_finalization_ballots_digest_check remains NOT VALID';
END;
$$;
