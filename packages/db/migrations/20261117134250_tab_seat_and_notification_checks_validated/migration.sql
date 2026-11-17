-- Validates the CHECKs the Tab folders before added NOT VALID to tables that
-- hold rows (main-sync-3): the open-seat check restated on seat_kind, and the
-- notification checks restated over main's catalogue and Tab's fixture kinds.
-- A stored row that breaks one must not refuse the deploy: that constraint
-- stays NOT VALID with a warning naming it, still refusing every new write,
-- until the row is repaired and a later migration validates it. A database
-- with no such row ends with every one validated.
DO $$
DECLARE
  pending record;
BEGIN
  FOR pending IN
    SELECT * FROM (VALUES
      ('room_participants', 'room_participants_open_seat_check'),
      ('notification_preferences', 'notification_preferences_pair_check'),
      ('notifications', 'notifications_kind_check'),
      ('notifications', 'notifications_subject_check'),
      ('notifications', 'notifications_actor_check')
    ) AS added(relation, constraint_name)
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', pending.relation, pending.constraint_name);
    EXCEPTION WHEN check_violation THEN
      RAISE WARNING 'constraint % on % stays NOT VALID: stored rows violate it', pending.constraint_name, pending.relation;
    END;
  END LOOP;
END $$;
