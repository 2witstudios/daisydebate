-- outbox.seq is the schema's first serial/bigserial column (RT-2.2). Its
-- DEFAULT calls nextval() on the backing sequence, which needs sequence
-- USAGE — a privilege the repo's existing table-only grant pattern
-- (docs/operations/database.md, infra/init-test-database.sql) never covered,
-- because no earlier table needed it. Without this grant, an INSERT into
-- outbox by a non-owner role fails with "permission denied for sequence
-- outbox_seq_seq", which is exactly what broke the production-mode e2e
-- server (running as daisy_e2e) on every session-revocation flow.
--
-- Every role that appends to the outbox needs this. `daisy` (the migration
-- owner, also today's web app and integration-test runtime role) already
-- has it implicitly through table ownership; the explicit grant below is
-- for daisy_e2e, and is written so a future distinct non-owner runtime role
-- only has to be added to this GRANT list, not rediscover the requirement.
-- infra/init-test-database.sql and docs/operations/database.md document the
-- same pattern for a volume this migration did not create the sequence on.
-- daisy_e2e is a local/test-only role (docs/operations/database.md); it
-- does not exist in production, where this migration also runs, so the
-- grant is conditional rather than failing that apply.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'daisy_e2e') THEN
    GRANT USAGE, SELECT ON SEQUENCE outbox_seq_seq TO daisy_e2e;
  END IF;
END
$$;
