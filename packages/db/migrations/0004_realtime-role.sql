-- Realtime service database role (RT-2.2; ADR 0032 "The realtime database
-- role"). This is the only credential the realtime service holds: SELECT on
-- the outbox delivery log and the authorization read models it needs to
-- authorize socket subscriptions and revalidate sessions.
--
-- No password is set here: production runtime credentials are provisioned
-- out of band, never committed (docs/operations/database.md). The migration
-- credential that runs this file needs CREATEROLE, also documented there.
-- Local/test sessions that need to connect as this role (for example its
-- own integration test) set a throwaway password themselves and clear it
-- afterwards; nothing in this repo sets one for daisy_realtime.
--
-- Column-scoped grants only (plan revision 4.6, ADR 0032 §7): `users` gets
-- no grant at all yet. Realtime resolves an actor's identity through
-- `actors.user_id` (already SELECT-granted below, no PII on that table),
-- never through `users` directly, so it needs no `users` column today.
-- Once RT-3.2b adds the invisible presence preference, that migration must
-- add `GRANT SELECT (<preference column>) ON users TO daisy_realtime;` and
-- nothing else on `users` — never email, name or image.
--
-- Deferred grant, documented here rather than pre-created: `service_instances`
-- (RT-4.3a) does not exist yet. RT-4.3a's migration must add:
--   GRANT INSERT, UPDATE ON service_instances TO daisy_realtime;
-- and nothing else: the role stays SELECT-only everywhere but that table.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'daisy_realtime') THEN
    CREATE ROLE daisy_realtime LOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO daisy_realtime;
--> statement-breakpoint
GRANT SELECT ON outbox, debates, debate_participants, actors TO daisy_realtime;
--> statement-breakpoint
-- Session revalidation (the 60s continuous-authorization check): id and
-- expiry decide liveness, user_id maps a session to its actor. Never
-- `token` (the bearer credential) or any users column.
GRANT SELECT (id, user_id, expires_at) ON session TO daisy_realtime;
