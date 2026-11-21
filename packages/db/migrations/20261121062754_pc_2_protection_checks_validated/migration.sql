-- Validate with a lower lock level after installing the expanded checks.
DO $$
DECLARE
  pending record;
BEGIN
  FOR pending IN
    SELECT * FROM (VALUES
      ('friendships', 'friendships_state'),
      ('friendships', 'friendships_time'),
      ('notification_preferences', 'notification_preferences_pair_check'),
      ('notifications', 'notifications_kind_check'),
      ('notifications', 'notifications_subject_check')
    ) AS added(relation, constraint_name)
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', pending.relation, pending.constraint_name);
    EXCEPTION WHEN check_violation THEN
      RAISE WARNING 'constraint % on % stays NOT VALID: stored rows violate it', pending.constraint_name, pending.relation;
    END;
  END LOOP;
END $$;
