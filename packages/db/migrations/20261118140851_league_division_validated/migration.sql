-- Validates the league division CHECK the folder before added NOT VALID. A
-- stored row that breaks it must not refuse the deploy: it stays NOT VALID
-- with a warning, still refusing every new write, until the row is repaired
-- and a later migration validates it.
DO $$
BEGIN
  ALTER TABLE public.organizations VALIDATE CONSTRAINT organizations_league_division_check;
EXCEPTION WHEN check_violation THEN
  RAISE WARNING 'constraint organizations_league_division_check on organizations stays NOT VALID: stored rows violate it';
END $$;
