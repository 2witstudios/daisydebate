-- Executed once on first volume initialization.
-- daisy_test hosts integration/e2e records; daisy_e2e is a loopback-only role
-- for the production-mode e2e server (its password must differ from the
-- development credential rejected by production configuration refinement).
CREATE DATABASE daisy_test;
CREATE ROLE daisy_e2e LOGIN PASSWORD 'e2e-loopback-only';
GRANT CONNECT ON DATABASE daisy_test TO daisy_e2e;
