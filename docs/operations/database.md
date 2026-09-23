# Database operations

Local development uses one shared Compose stack (Postgres on 15432, Redis on 6379) and a database slot per checkout ([ADR 0034](../decisions/0034-shared-stack-slots.md)). `bun slot:up` starts the stack, creates the loopback-only `daisy_e2e` login and the `daisy_template` database if missing, copies this checkout's dev and test databases from the template (`daisy`/`daisy_test` in the main checkout, `daisy_wt_<id>`/`daisy_wt_<id>_test` in a worktree), migrates both, and writes their URLs into `.env`. The template carries the `daisy_e2e` schema usage and default table and sequence privileges, so every slot's test database is ready for the browser suite, which signs in for real. The sequence privilege matters: a `serial`/`bigserial` default calls `nextval()`, which table privileges do not cover (RT-2.2's `outbox.seq` is the first such column), and without it the production-mode e2e server fails every insert into such a table with "permission denied for sequence". `bun slot:down` drops a worktree's databases and Redis keys; `bun slot:prune` (also run by every `slot:up`) drops those of worktrees git no longer lists. Redis keys go by namespace with `SCAN` and `UNLINK`, never `FLUSHDB`. Never stop or recreate the shared stack while other checkouts use it.

Change a feature-owned schema file, run `bun db:generate`, review generated SQL and commit SQL plus metadata. Use expand/contract changes for rolling deployments. Do not edit applied migrations; add a forward correction. The only sanctioned history rewrite is a greenfield baseline squash recorded in `policy/migration-baselines.json` (ADR 0023), which requires resetting every local and test database once. Deploy migrations once as a release job before enabling dependent application code; do not run concurrently from every app instance. Back up production before destructive changes and test restore procedures. Production runtime credentials should not have schema-alter privileges; use separate migration credentials.

Run `bun db:migrate` with DATABASE_URL. The runtime migrator uses the native Bun driver. `bun db:studio` is a local inspection tool and must not be exposed publicly. Reset (`bun db:reset`) is destructive and accepts only the current checkout's own two slot databases, on loopback, with `ALLOW_DATABASE_RESET=yes`, never in production; it must never be part of startup. It recreates `public`, restores the `daisy_e2e` grants, and re-applies committed migrations.

**No backfill migrations pre-ship (ADR 0018, ADR 0023, ACTOR-1, plan revision 4.12).** Daisy has no deployed consumers, so a schema change that needs existing rows to carry a new application-owned identifier is never a data backfill: cuid2 must be minted at the application boundary (ADR 0018), and a migration cannot do that. ACTOR-1 (actors created at username-claim onboarding) shipped with no backfill migration for exactly this reason: instead, reset and re-migrate any local or test database holding rows from before that change (`bun db:reset` — see above — reapplies every committed migration onto an empty schema, so the actor-provisioning write path recreates rows going forward). Do not add a policy exception to reach for `gen_random_uuid()` or any other database-side generator as a substitute; reset the database instead.

**Migration concurrency:** generation is single-writer across the whole repository at a time — two branches that each run `bun db:generate` collide on the journal. `bun migrations:check` compares the committed journal and the shared migration SQL files against the merge base with `origin/main` and fails a PR that rewrites, reorders, truncates, chain-breaks, deletes, or edits the journal metadata (including timestamps) of shared migrations. Resolve collisions by rebasing and regenerating the conflicting tail as a forward correction; never auto-rewrite applied migrations on `main` after the fact.

Integration tests require explicit TEST_DATABASE_URL ending in `_test`, and TEST_REDIS_URL. `bun slot:up` writes and migrates this checkout's test database; TEST_REDIS_URL stays the shared Redis database 1, where every integration test uses its own random namespace. Tests use unique identifiers/namespaces and clean up only owned records. Never point them at production. Use health checks in Compose and readiness before traffic. Database pool sizing is per instance: sum of instance pool limits plus migrations/admin capacity must remain below PostgreSQL max_connections.

**Realtime service role (RT-2.2, ADR 0032 §7).** Migration
`0004_realtime-role.sql` creates `daisy_realtime` (idempotent
`CREATE ROLE ... LOGIN`, no password) and grants it `SELECT` on `outbox`,
`debates` and `debate_participants` in full, a column-scoped
`SELECT (id, user_id)` on `actors`, and a column-scoped
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
never commit a real one.

The same migration also grants `USAGE, SELECT` on `outbox`'s backing
sequence (see the serial/sequence note above), folded into the migration
that creates the outbox's role rather than a separate one (plan revision
4.8), to every runtime role that appends to the outbox: `daisy` (the
migration owner, also today's web app and integration-test runtime role)
already has it implicitly through table ownership; `daisy_e2e` gets it
conditionally, since that role does not exist in production. **Production
operations step:** once production provisions a web runtime credential
distinct from the migration owner `daisy` (this repository's "production
runtime credentials should not have schema-alter privileges" guidance
above), that role needs the same grant, run once as an admin role:
`GRANT USAGE, SELECT ON SEQUENCE outbox_seq_seq TO <production web runtime role>;`
— no migration creates that role, so this is a manual provisioning step,
not something `bun db:migrate` covers.

**Outbox retention throughput (RT-2.2).** The maintenance sweep prunes
outbox rows older than the 24h retention window in batches of at most 200
rows per call (`RETENTION_BATCH_LIMIT` in `packages/db/src/outbox.ts`),
`FOR UPDATE SKIP LOCKED` so a concurrent drain is never blocked, run hourly
with up to 200 batches per run (40,000 rows/run), sized against an expected
write rate of 10 rows/s (36,000 rows/hour) so one run always clears a full
hour's growth with headroom.

Database availability is necessary but not sufficient readiness. Deployers must ensure migrations are applied, monitor storage/replication/backup lag, enforce TLS for remote database and Redis connections, and set network access policy. Local plaintext credentials are intentionally confined to loopback. Redis persistence is off locally to expose accidental reliance on durable cache state.
