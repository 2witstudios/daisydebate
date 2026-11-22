DO $validate$
DECLARE
  pending record;
BEGIN
  FOR pending IN
    SELECT * FROM (VALUES
      ('lobbies', 'lobbies_age_rule_source'),
      ('settings', 'settings_key_check')
    ) AS added(relation, constraint_name)
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', pending.relation, pending.constraint_name);
    EXCEPTION WHEN check_violation THEN
      RAISE WARNING 'constraint % on % stays NOT VALID: stored rows violate it', pending.constraint_name, pending.relation;
    END;
  END LOOP;
END $validate$;
