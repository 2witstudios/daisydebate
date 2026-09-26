# Backup, restore and post-restore rehearsal (AUTH-7.6)

Staging-only rehearsal proving `daisy_debate_staging` can be dumped and
restored into an isolated database with every FK relationship intact, and
that the post-restore step makes a pre-restore session cookie or emailed
link unable to authenticate before the restored copy takes traffic.
Scope change 2026-09-25 (DEC-13): the release-environment backup criterion
(encrypted backups, RPO 1h, RTO 4h) left the plan with the production
release; this leaf proves the mechanics only, never against production.

## Postgres access

Staging Postgres (`daisy-debate-staging-db`) is a single Fly machine with no
external endpoint; every command below runs inside it over
`fly ssh console`, never from an operator's own machine, so the superuser
credential (`$OPERATOR_PASSWORD`, already present in that machine's own
environment) never leaves it:

```
fly ssh console -a daisy-debate-staging-db -C "sh -c 'echo <base64 script> | base64 -d | sh'"
```

The script inside uses `PGPASSWORD="$OPERATOR_PASSWORD"` with `psql`,
`pg_dump`, `pg_restore`, `createdb` and `dropdb` — never prints the
password, and the base64 wrapper only avoids quoting problems over SSH, not
secrecy (the script text itself holds no secret). Evidence below is limited
to table names, row counts and exit codes.

## 1. Synthetic content

Staging held zero rows in every auth and debate table when this rehearsal
started (`bun doctor`-style row counts, all zero). Per the leaf's
acceptance criteria, `scripts/staging-restore-seed.ts` creates a
representative slice — synthetic, never real personal data:

- Two users (`restore-rehearsal-a@example.test`,
  `restore-rehearsal-b@example.test`, RFC 2606 reserved domain, never
  delivered), both `emailVerified: true`
- Their actors, one debate (`foundation` format) seating both as
  affirmative/negative (`debate_participants`)
- One session and one passkey per user, one verification token

It runs through `@daisy/db`'s `applyDevSeed` adapter operation for the
users/actors/debate (extended with optional `email`/`emailVerified` fields
for this leaf) and direct inserts for `session`/`passkey`/`verification`,
which `applyDevSeed` does not cover. Idempotent like `applyDevSeed`: rerun
leaves every row unchanged. Runs from the staging web machine itself
(`fly ssh console -a daisy-debate-staging`), using that machine's own
`DATABASE_URL` (the `daisy_web` runtime role, which already holds
`INSERT`/`UPDATE`/`DELETE` on every table) — never the migration owner
credential:

```
fly ssh console -a daisy-debate-staging -C "sh -c 'set -e; trap \"rm -f /app/apps/web/tmp-seed.ts\" EXIT; echo <base64 of scripts/staging-restore-seed.ts> | base64 -d > /app/apps/web/tmp-seed.ts && cd /app/apps/web && bun tmp-seed.ts'"
```

`set -e` plus an `EXIT` trap: a decode or seed failure now fails the whole
command (instead of being masked by a `rm -f` that still exits 0), while the
temporary file is still removed on every path, success or failure.

Verified row counts after seeding, `daisy_debate_staging`:

| Table                 | Count |
| --------------------- | ----- |
| `users`               | 2     |
| `actors`              | 2     |
| `passkey`             | 2     |
| `session`             | 2     |
| `verification`        | 1     |
| `debates`             | 1     |
| `debate_participants` | 2     |

FK joins on the source, all matching the row counts above:
`users ⋈ passkey` = 2, `users ⋈ session` = 2,
`users ⋈ actors ⋈ debate_participants` = 2.

## 2. Backup

```sql
pg_dump -h localhost -U postgres -d daisy_debate_staging -Fc -f /tmp/staging-rehearsal.dump
```

Custom format (`-Fc`), 67,524 bytes for this rehearsal's content.

## 3. Restore into an isolated database

Never over `daisy_debate_staging`. `daisy_debate_restore_rehearsal`, on the
same machine, dropped at the end of the rehearsal:

```sql
dropdb -h localhost -U postgres --if-exists daisy_debate_restore_rehearsal
createdb -h localhost -U postgres daisy_debate_restore_rehearsal
pg_restore -h localhost -U postgres -d daisy_debate_restore_rehearsal --no-owner --no-privileges /tmp/staging-rehearsal.dump
```

Exit code 0. `--no-owner --no-privileges` because the restore target has no
`daisy_web`/`daisy_migrator` roles of its own — this rehearsal proves data
and relationships survive a restore, not role provisioning (a real recovery
restores into a database whose roles the baseline migration already
created).

## 4. Proof: relationships survived

Row counts, `daisy_debate_restore_rehearsal`, identical to the source
table above (`users` 2, `actors` 2, `passkey` 2, `session` 2,
`verification` 1, `debates` 1, `debate_participants` 2). FK joins on the
restored copy: `users ⋈ passkey` = 2, `users ⋈ session` = 2,
`users ⋈ actors ⋈ debate_participants` = 2 — every relationship the source
held, held on the restored copy.

## 5. Post-restore step: proof it disables pre-restore auth

The committed, tested path is `bun scripts/post-restore-invalidate.ts`
(`packages/db`'s `Database.purgeAllForRestore` plus `@daisy/redis/namespaces`'s
`clearAuthRateLimits`), run against the restored database's `DATABASE_URL`
and `REDIS_URL`/`REDIS_NAMESPACE` before it takes traffic:

```
DATABASE_URL=<restore copy> REDIS_URL=<its redis> REDIS_NAMESPACE=<its namespace> \
  bun scripts/post-restore-invalidate.ts \
  --confirm-redis-namespace <its namespace>
```

It refuses unless the database name contains "restore" (`--force` overrides
for a database independently confirmed isolated) — a naming-mistake guard,
tested in `scripts/restore-guard.test.ts`. The Redis target is guarded
separately: `--confirm-redis-namespace` must retype `REDIS_NAMESPACE`'s
exact value, since a real restore's namespace need not contain "restore"
at all (a blue/green restore can reuse the live namespace on purpose) —
there is no name pattern to infer isolation from, so the operator states it
explicitly instead. The full real-path proof is
`apps/web/integration/auth-restore-invalidation.integration.ts`: a real
sign-in through the mounted routes, a real session cookie, then
`purgeAllForRestore`/`clearAuthRateLimits` exactly as the script runs them,
then the same cookie replayed against the real `identify` seam — RED
without the purge (`identify` still resolves `provisional`), GREEN with it
(`identify` resolves `anonymous`).

On this rehearsal's isolated copy, the equivalent SQL
(`DELETE FROM session; DELETE FROM verification;`, what
`purgeAllForRestore` runs in one transaction) removed 2 sessions and 1
verification row. Before: the seeded session's token
(`restore-seed-session-token-0`) matched exactly one `session` row. After:
zero rows match that token — the same token a client's cookie would carry
can no longer resolve to a session, exactly as the integration test proves
through the real HTTP path. `daisy_debate_staging` (the live source) was
checked immediately after and still held its original 2 sessions and 1
verification row — the invalidation never touched anything outside the
isolated copy.

## 6. Cleanup

```sql
select pg_terminate_backend(pid) from pg_stat_activity where datname = 'daisy_debate_restore_rehearsal' and pid <> pg_backend_pid();
dropdb -h localhost -U postgres --if-exists daisy_debate_restore_rehearsal
rm -f /tmp/staging-rehearsal.dump
```

Confirmed: `daisy_debate_restore_rehearsal` absent from `pg_database`, dump
file absent. The synthetic seed rows in `daisy_debate_staging` itself are
left in place deliberately — representative content for the next rehearsal
or for exercising staging by hand, not a leftover to clean up.

## Reproducing this rehearsal

1. Confirm the target is staging, never production, for **both** apps the
   rehearsal touches: `fly status -a daisy-debate-staging-db` names the
   database app step 2 restores, and, separately,
   `fly ssh console -a daisy-debate-staging -C 'printenv DATABASE_URL'`
   confirms the **web app's own** `DATABASE_URL` (the one section 1's seed
   command actually runs under) points at `daisy_debate_staging` and not
   some other database — checking the database app alone says nothing
   about which database the web app's seed step writes to.
2. Seed if the row counts in step 1 come back zero.
3. Run steps 2–4 verbatim; halt before step 5 if any count mismatches.
4. Run step 5 only against the isolated copy — `scripts/restore-guard.ts`
   refuses a `DATABASE_URL` without "restore" in the database name for
   exactly this reason, and separately refuses to touch Redis at all
   unless `--confirm-redis-namespace` retypes the exact `REDIS_NAMESPACE`
   in use.
5. Always run step 6, even after a failure partway through.
