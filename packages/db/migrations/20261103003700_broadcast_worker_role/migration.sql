-- daisy_broadcast_worker: the hold worker's only credential (ADR 0099, BCAST-4).
-- It reads and updates broadcasts and touches nothing else, so it cannot read or
-- change a Round. Explicit grants only. No password here: staging and production
-- provision the credential out of band.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'daisy_broadcast_worker') THEN
    CREATE ROLE daisy_broadcast_worker LOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO daisy_broadcast_worker;
--> statement-breakpoint
GRANT SELECT, UPDATE ON broadcasts TO daisy_broadcast_worker;
