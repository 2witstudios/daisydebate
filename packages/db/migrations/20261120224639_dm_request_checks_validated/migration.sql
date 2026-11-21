-- Validate after the schema change releases its exclusive notification locks.
DO $$
DECLARE
  pending record;
BEGIN
  FOR pending IN
    SELECT * FROM (VALUES
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
--> statement-breakpoint
-- These builds can take a write lock while allowing inbox reads.
CREATE UNIQUE INDEX "notifications_dm_request_once" ON "notifications" ("user_id","kind","dm_channel_id") WHERE "dm_channel_id" is not null;--> statement-breakpoint
CREATE INDEX "notifications_dm_channel_idx" ON "notifications" ("dm_channel_id");
