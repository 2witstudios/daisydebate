-- Validates the CHECKs the folder before added NOT VALID to tables that hold
-- rows. A stored row that breaks one must not refuse the deploy: that
-- constraint stays NOT VALID with a warning naming it, still refusing every
-- new write, until the row is repaired and a later migration validates it.
-- A database with no such row ends with every one validated.
DO $$
DECLARE
  pending record;
BEGIN
  FOR pending IN
    SELECT * FROM (VALUES
      ('rooms', 'rooms_host_by_lobby_kind'),
      ('rooms', 'rooms_event_is_casual'),
      ('rooms', 'rooms_ballot_definition_complete'),
      ('ballots', 'ballots_ballot_definition_complete'),
      ('formats', 'formats_one_owner_at_most')
    ) AS added(relation, constraint_name)
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', pending.relation, pending.constraint_name);
    EXCEPTION WHEN check_violation THEN
      RAISE WARNING 'constraint % on % stays NOT VALID: stored rows violate it', pending.constraint_name, pending.relation;
    END;
  END LOOP;
END $$;
