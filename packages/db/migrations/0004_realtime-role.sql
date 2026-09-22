-- Realtime service database role (RT-2.2; plan "D. Zero-trust socket auth" /
-- "No web→realtime secret exists at all"). This is the only credential the
-- realtime service holds: SELECT on the outbox delivery log and the read
-- models it needs to authorize socket subscriptions (debate visibility and
-- seating, and the identities a ticket's actorId/userId resolve against).
--
-- No password is set here: production runtime credentials are provisioned
-- out of band (docs/operations/database.md), never committed. Local and
-- test stacks set a loopback-only password in infra/init-test-database.sql,
-- mirroring the existing daisy_e2e role.
--
-- Deferred grants, documented here rather than pre-created (plan revision
-- 4.2), because their tables/columns do not exist yet:
--   - service_instances (RT-4.3a) does not exist yet. RT-4.3a's migration
--     must add: GRANT INSERT, UPDATE ON service_instances TO daisy_realtime;
--     and nothing else: the role stays SELECT-only everywhere but that table.
--   - The invisible presence preference (RT-3.2b) does not exist yet.
--     RT-3.2b's migration must add SELECT on that column (or its table) to
--     daisy_realtime, so realtime can honor it without a broader grant.
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
-- Column-scoped, not the whole table: resolving a ticket's userId only needs
-- the row's existence and id, never email, name, image or the tombstone
-- fields. A full-table grant would hand a compromised realtime credential
-- account PII (AGENTS.md: zero trust at every boundary).
GRANT SELECT (id) ON users TO daisy_realtime;
