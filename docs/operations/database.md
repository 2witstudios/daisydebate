# Database operations

Start local infrastructure with `bun infra:up`. Docker initialization creates `daisy` and `daisy_test` on the first volume initialization, plus the `daisy_e2e` login used by the production-mode browser suite. If an existing volume predates those roles, create them explicitly: `CREATE ROLE daisy_e2e LOGIN PASSWORD 'e2e-loopback-only'; GRANT CONNECT ON DATABASE daisy_test TO daisy_e2e;`. The browser suite signs in for real, so `daisy_e2e` also needs table access in `daisy_test`; the init script grants it by default privileges, and an existing volume needs `GRANT USAGE ON SCHEMA public TO daisy_e2e; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO daisy_e2e; ALTER DEFAULT PRIVILEGES FOR ROLE daisy IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO daisy_e2e;` run once as `daisy` against `daisy_test`. A `serial`/`bigserial` column's default needs sequence `USAGE` too, which table privileges do not cover (RT-2.2's `outbox.seq` is the first table to use one): an existing volume also needs `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO daisy_e2e; ALTER DEFAULT PRIVILEGES FOR ROLE daisy IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO daisy_e2e;`, or the production-mode e2e server 500s on any insert into such a table with "permission denied for sequence".

Change a feature-owned schema file, run `bun db:generate`, review generated SQL and commit SQL plus metadata. Use expand/contract changes for rolling deployments. Do not edit applied migrations; add a forward correction. The only sanctioned history rewrite is a greenfield baseline squash recorded in `policy/migration-baselines.json` (ADR 0023), which requires resetting every local and test database once. Deploy migrations once as a release job before enabling dependent application code; do not run concurrently from every app instance. Back up production before destructive changes and test restore procedures. Production runtime credentials should not have schema-alter privileges; use separate migration credentials.

Run `bun db:migrate` with DATABASE_URL. The runtime migrator uses the native Bun driver. `bun db:studio` is a local inspection tool and must not be exposed publicly. Reset is destructive and restricted to loopback daisy/daisy_test URLs with `ALLOW_DATABASE_RESET=yes`; it must never be part of startup. Reset re-applies committed migrations.

**Migration concurrency:** generation is single-writer across the whole repository at a time — two branches that each run `bun db:generate` collide on the journal. `bun migrations:check` compares the committed journal and the shared migration SQL files against the merge base with `origin/main` and fails a PR that rewrites, reorders, truncates, chain-breaks, deletes, or edits the journal metadata (including timestamps) of shared migrations. Resolve collisions by rebasing and regenerating the conflicting tail as a forward correction; never auto-rewrite applied migrations on `main` after the fact.

Integration tests require explicit TEST_DATABASE_URL ending in `_test`, and TEST_REDIS_URL. Migrate the test database first: `DATABASE_URL="$TEST_DATABASE_URL" bun db:migrate`. Tests use unique identifiers/namespaces and clean up only owned records. Never point them at production. Use health checks in Compose and readiness before traffic. Database pool sizing is per instance: sum of instance pool limits plus migrations/admin capacity must remain below PostgreSQL max_connections.

**Realtime service role (RT-2.2, ADR 0032 §7).** Migration
`0004_realtime-role.sql` creates `daisy_realtime` (idempotent
`CREATE ROLE ... LOGIN`, no password) and grants it `SELECT` on `outbox`,
`debates`, `debate_participants` and `actors` in full, plus a column-scoped
`SELECT (id, user_id, expires_at)` on `session` for the 60s continuous
re-authorization check — never `token`, the bearer credential. It gets
**no grant on `users` at all today**: identity resolves through
`actors.user_id`, which carries no PII, so there is nothing on `users` to
grant until RT-3.2b's invisible presence preference exists (that migration
must add `SELECT` on that one column and nothing else on `users`). This
migration's `CREATE ROLE` needs the migration credential to hold
`CREATEROLE`; production's migration credential (already separate from its
runtime credential, see below) must have it. It is the only Postgres
credential the realtime service holds (ADR 0032: "No web→realtime secret
exists at all"); production sets its runtime password out of band, never
committed. The `service_instances` grant is deferred the same way,
documented in the migration rather than pre-created, since the table
doesn't exist yet: RT-4.3a's migration must add
`GRANT INSERT, UPDATE ON service_instances TO daisy_realtime;` and nothing
else — the role stays `SELECT`-only everywhere but that table. Local/test
sessions that need to connect as this role (for example its own integration
test) set a throwaway password with
`ALTER ROLE daisy_realtime LOGIN PASSWORD '...'` and clear it afterwards;
never commit a real one. Migration `0005_outbox-sequence-grants.sql` grants
`daisy_e2e` `USAGE`/`SELECT` on `outbox`'s backing sequence (see the
serial/sequence note above) and documents the same pattern for any future
non-owner role that appends to a table with a `serial`/`bigserial` column.

Database availability is necessary but not sufficient readiness. Deployers must ensure migrations are applied, monitor storage/replication/backup lag, enforce TLS for remote database and Redis connections, and set network access policy. Local plaintext credentials are intentionally confined to loopback. Redis persistence is off locally to expose accidental reliance on durable cache state.
