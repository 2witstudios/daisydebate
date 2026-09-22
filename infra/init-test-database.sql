-- Executed once on first volume initialization.
-- daisy_test hosts integration/e2e records; daisy_e2e is a loopback-only role
-- for the production-mode e2e server (its password must differ from the
-- development credential rejected by production configuration refinement).
CREATE DATABASE daisy_test;
CREATE ROLE daisy_e2e LOGIN PASSWORD 'e2e-loopback-only';
GRANT CONNECT ON DATABASE daisy_test TO daisy_e2e;
-- The browser suite drives real sign-in through the production server as
-- daisy_e2e, so it needs the tables the migrations (run as daisy) create.
\connect daisy_test
GRANT USAGE ON SCHEMA public TO daisy_e2e;
ALTER DEFAULT PRIVILEGES FOR ROLE daisy IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO daisy_e2e;
-- A serial/bigserial column's default (nextval()) needs sequence USAGE,
-- which table privileges do not cover (RT-2.2: outbox.seq is the first
-- table to use one, surfaced as "permission denied for sequence" 500s from
-- the production-mode e2e server on any outbox insert without this grant).
ALTER DEFAULT PRIVILEGES FOR ROLE daisy IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO daisy_e2e;
