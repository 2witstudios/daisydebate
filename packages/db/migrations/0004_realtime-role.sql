-- Realtime service database role (RT-2.2; ADR 0032 "The realtime database
-- role", plan revision 4.8). This is the only credential the realtime
-- service holds: SELECT on the outbox delivery log and the authorization
-- read models it needs to authorize socket subscriptions and revalidate
-- sessions.
--
-- No password is set here: production runtime credentials are provisioned
-- out of band, never committed (docs/operations/database.md). The migration
-- credential that runs this file needs CREATEROLE, also documented there.
-- Local/test sessions that need to connect as this role (for example its
-- own integration test) set a throwaway password themselves and clear it
-- afterwards; nothing in this repo sets one for daisy_realtime.
--
-- Column-scoped grants (plan revision 4.8, ADR 0032 §7): `actors` and
-- `session` are column-scoped; `users` gets no grant at all yet. Realtime
-- resolves an actor's identity through `actors.user_id`, which carries no
-- PII, never through `users` directly, so it needs no `users` column today.
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
GRANT SELECT ON outbox, debates, debate_participants TO daisy_realtime;
--> statement-breakpoint
-- Subscribe authorization maps a socket's actor to `actors.user_id`; kind
-- and the audit timestamps carry nothing realtime needs.
GRANT SELECT (id, user_id) ON actors TO daisy_realtime;
--> statement-breakpoint
-- Session revalidation (the 60s continuous-authorization check): id and
-- expiry decide liveness, user_id maps a session to its actor. Never
-- `token` (the bearer credential) or any users column.
GRANT SELECT (id, user_id, expires_at) ON session TO daisy_realtime;
--> statement-breakpoint
-- outbox.seq is the schema's first serial/bigserial column (RT-2.2). Its
-- DEFAULT calls nextval() on the backing sequence, which needs sequence
-- USAGE — a privilege the repo's existing table-only grant pattern
-- (docs/operations/database.md, infra/init-test-database.sql) never covered,
-- because no earlier table needed it. Without this grant, an INSERT into
-- outbox by a non-owner role fails with "permission denied for sequence
-- outbox_seq_seq", which is exactly what broke the production-mode e2e
-- server (running as daisy_e2e) on every session-revocation flow.
--
-- Every runtime role that appends to the outbox needs this, granted here in
-- the migration that creates the outbox's role, not a separate one (plan
-- revision 4.8). `daisy` (the migration owner, also today's web app and
-- integration-test runtime role) already has it implicitly through table
-- ownership. `daisy_e2e` is a local/test-only role
-- (docs/operations/database.md); it does not exist in production, where
-- this migration also runs, so its grant is conditional rather than
-- failing that apply. Production's web runtime role — once provisioned as
-- a credential distinct from the migration owner `daisy`, per
-- docs/operations/database.md's "production runtime credentials should not
-- have schema-alter privileges" — needs the same grant as an explicit
-- operations step, documented there, since no such role is created by any
-- migration in this repository.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'daisy_e2e') THEN
    GRANT USAGE, SELECT ON SEQUENCE outbox_seq_seq TO daisy_e2e;
  END IF;
END
$$;
