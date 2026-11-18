-- Validates the widened stop-reason CHECK the folder before added NOT VALID
-- (ADR 0150). A stored row that breaks it must not refuse the deploy: the
-- constraint then stays NOT VALID with a warning, still refusing every new
-- write, until the row is repaired and a later migration validates it.
DO $$
BEGIN
  ALTER TABLE public.broadcasts VALIDATE CONSTRAINT broadcasts_stop_reason_check;
EXCEPTION WHEN check_violation THEN
  RAISE WARNING 'constraint % on % stays NOT VALID: stored rows violate it', 'broadcasts_stop_reason_check', 'broadcasts';
END $$;
