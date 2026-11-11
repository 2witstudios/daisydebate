-- Validates the CHECKs the folder before added NOT VALID. A stored row that
-- breaks one must not refuse the deploy: that constraint stays NOT VALID with a
-- warning naming it, still refusing every new write, until the row is repaired
-- and a later migration validates it. A database with no such row ends with
-- every one validated.
DO $$
DECLARE
  pending record;
BEGIN
  FOR pending IN
    SELECT * FROM (VALUES
      ('broadcasts', 'broadcasts_stop_reason_check'),
      ('broadcasts', 'broadcasts_completed_check'),
      ('broadcasts', 'broadcasts_feed_withdrawn_check'),
      ('broadcasts', 'broadcasts_egress_check'),
      ('broadcasts', 'broadcasts_feed_withdrawal_requested_check'),
      ('broadcasts', 'broadcasts_observer_revoked_check'),
      ('moderation_actions', 'moderation_actions_ends_after_start_check'),
      ('moderation_actions', 'moderation_actions_lifted_after_start_check'),
      ('recordings', 'recordings_deletion_due_check')
    ) AS added(relation, constraint_name)
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', pending.relation, pending.constraint_name);
    EXCEPTION WHEN check_violation THEN
      RAISE WARNING 'constraint % on % stays NOT VALID: stored rows violate it', pending.constraint_name, pending.relation;
    END;
  END LOOP;
END $$;
