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

`set -e` fails the whole command on a decode or seed error; the `EXIT` trap
removes the temporary file on every path, success or failure.

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

`bun scripts/post-restore-invalidate.ts` (`packages/db`'s
`Database.purgeAllForRestore` plus `@daisy/redis/namespaces`'s
`clearAuthRateLimits`) is the committed, tested implementation of this
step, run against the restored database's `DATABASE_URL` and
`REDIS_URL`/`REDIS_NAMESPACE` before it takes traffic:

```
DATABASE_URL=<restore copy> REDIS_URL=<its redis> REDIS_NAMESPACE=<its namespace> \
  bun scripts/post-restore-invalidate.ts \
  --confirm-redis-namespace <its namespace> \
  --confirm-redis-host <its redis host, e.g. host:port>
```

**This does not run on `daisy-debate-staging-db` or `daisy-debate-staging`
themselves — three separate reasons, any one of which alone would block
it**: `daisy-debate-staging-db` has no repository checkout and no `bun`
(it is a bare Postgres machine); `daisy-debate-staging`'s deployed image
has no `scripts/` directory (the Next.js production build output only,
never the repo root); and even given a way to run it, the restored copy
(`--no-owner --no-privileges`, section 3) grants nothing to `daisy_web` —
that role does not exist as a grantee on this ad hoc database at all, so it
could not `DELETE` from `session`/`verification` even if the script could
reach it. "On staging" below is what actually ran against this rehearsal's
restored copy, and is the real staging procedure until one of the three
blockers above is removed (a runner image with the repo, or a role
explicitly granted on every restored copy — neither exists today, so this
is not a placeholder).

The script itself refuses unless the database name contains "restore"
(`--force` overrides for a database independently confirmed isolated) — a
naming-mistake guard, tested in `scripts/restore-guard.test.ts`. The Redis
target is guarded separately, by two confirmations: `--confirm-redis-namespace`
must retype `REDIS_NAMESPACE`'s exact value, since a real restore's
namespace need not contain "restore" at all (a blue/green restore can reuse
the live namespace on purpose) — there is no name pattern to infer
isolation from, so the operator states it explicitly instead. Confirming
the namespace alone still leaves a gap: this repo's Redis is shared per
environment and isolated only by namespace (ADR 0034), so a correctly
confirmed namespace says nothing about whether `REDIS_URL` itself points at
that same live deployment's Redis rather than an isolated one —
`--confirm-redis-host` closes it, retyping `REDIS_URL`'s host only (never
the full URL, which routinely carries a password a command-line argument
must never hold).

The full real-path proof of the script's own logic is
`apps/web/integration/auth-restore-invalidation.integration.ts`: a real
sign-in through the mounted routes, a real session cookie, a real,
unredeemed magic-link token, a real rate-limit key, then
`purgeAllForRestore`/`clearAuthRateLimits` exactly as the script runs them,
then each artifact replayed against the real seam that would have accepted
it — the session cookie against `identify`, the magic-link token against
the real `/auth/confirm` redemption path, the rate-limit key against Redis
directly. RED without the purge (`identify` still resolves `provisional`,
the verification row still exists), GREEN with it (`identify` resolves
`anonymous`, the redemption is rejected exactly as a replayed/invalid
token is, the rate-limit key is gone).

`bun scripts/post-restore-invalidate.ts` (`bun restore:invalidate`) is also
run end to end, not only through the functions it calls: seeded this
checkout's own dev database with `scripts/staging-restore-seed.ts --force`,
`pg_dump`/`pg_restore`'d it into an isolated
`daisy_wt_e2qc2pm6_restore_proof` database (same local Postgres container,
`docker exec daisy-postgres-1 pg_dump`/`pg_restore`), then ran the real
command:

```
DATABASE_URL=postgres://daisy:...@localhost:15432/daisy_wt_e2qc2pm6_restore_proof \
REDIS_URL=redis://localhost:6379/1 REDIS_NAMESPACE=daisy-wt-e2qc2pm6-restore-proof \
  bun restore:invalidate \
  --confirm-redis-namespace daisy-wt-e2qc2pm6-restore-proof \
  --confirm-redis-host localhost:6379
```

Output: `{"database":"daisy_wt_e2qc2pm6_restore_proof","redisNamespace":"daisy-wt-e2qc2pm6-restore-proof","deletedSessions":2,"deletedVerifications":1,"clearedRateLimitKeys":0}`.
The source dev database kept its own 2 sessions and 1 verification row
afterward, confirmed by direct query. The isolated database and dump file
were dropped after.

### On staging: the actual procedure

The equivalent of `purgeAllForRestore` — the same two statements, in the
same one transaction — run directly against the restored copy as the
Postgres superuser, over `fly ssh console`, the same access pattern this
whole document uses for every other staging Postgres command; it needs no
repo, no `bun`, and no privilege the restore did not already grant the
superuser as the restore's owner:

```
fly ssh console -a daisy-debate-staging-db -C \
  "sh -c 'PGPASSWORD=\"\$OPERATOR_PASSWORD\" psql -h localhost -U postgres -d daisy_debate_restore_rehearsal -v ON_ERROR_STOP=1 -c \"BEGIN; DELETE FROM session; DELETE FROM verification; COMMIT;\"'"
```

Executed against this rehearsal's `daisy_debate_restore_rehearsal`: removed
2 sessions and 1 verification row. Before: the seeded session's token
matched exactly one `session` row. After: zero rows match that token — the
same token a client's cookie would carry can no longer resolve to a
session, exactly as the integration test proves through the real HTTP
path. `daisy_debate_staging` (the live source) was checked immediately
after and still held its original 2 sessions and 1 verification row — the
invalidation never touched anything outside the isolated copy.

There is no isolated Redis namespace in this rehearsal to run
`clearAuthRateLimits`'s equivalent against — this exercise dumps and
restores Postgres only, and Redis holds no durable state a backup would
need to restore (rate-limit counters and presence data are expected to
reset, never to survive a restore). `clearAuthRateLimits`'s own logic is
proven above, against a real Redis, by both the integration test and the
local `bun restore:invalidate` run. A real disaster recovery that also
provisions an isolated Redis namespace for the restored copy would clear it
the same way this section clears Postgres: the raw commands
(`SCAN`/`DEL` on the `rl:*` sub-namespace) run wherever that Redis is
actually reachable from, never by assuming the committed script itself can
run against the restore target.

## 6. Cleanup

```sql
select pg_terminate_backend(pid) from pg_stat_activity where datname = 'daisy_debate_restore_rehearsal' and pid <> pg_backend_pid();
dropdb -h localhost -U postgres --if-exists daisy_debate_restore_rehearsal
rm -f /tmp/staging-rehearsal.dump
```

Confirmed: `daisy_debate_restore_rehearsal` absent from `pg_database`, dump
file absent. The synthetic seed rows in `daisy_debate_staging` (users,
actors, passkeys, the debate, the verification row) are left in place
deliberately — representative content for the next rehearsal or for
exercising staging by hand, not a leftover to clean up. Their `session`
rows do not stay in that state: the secret-rotation rehearsal's emergency
`BETTER_AUTH_SECRET` step (`secret-rotation-rehearsal.md`) later deleted
every `session` row on staging, these included — rerunning
`scripts/staging-restore-seed.ts` recreates them.

## Reproducing this rehearsal

1. Confirm the target is staging, never production, for **both** apps the
   rehearsal touches: `fly status -a daisy-debate-staging-db` names the
   database app step 2 restores, and, separately, confirm the **web app's
   own** `DATABASE_URL` (the one section 1's seed command actually runs
   under) points at `daisy_debate_staging` and not some other database —
   checking the database app alone says nothing about which database the
   web app's seed step writes to. Never `printenv DATABASE_URL` for this:
   that prints the `daisy_web` password to the terminal. Print only the
   database name instead, exactly what `scripts/staging-restore-seed.ts`'s
   own guard checks:
   ```
   fly ssh console -a daisy-debate-staging -C "bun -e 'console.log(new URL(process.env.DATABASE_URL).pathname.slice(1))'"
   ```
2. Seed if the row counts in step 1 come back zero.
3. Run steps 2–4 verbatim; halt before step 5 if any count mismatches.
4. On staging, run step 5's "On staging" procedure against the isolated
   copy only, never `bun scripts/post-restore-invalidate.ts` directly — it
   cannot reach `daisy-debate-staging-db`. Where the target is a database
   the script itself can reach (this checkout's own dev database, or any
   future restore target with a repo and a granted role), run the script
   instead: `scripts/restore-guard.ts` refuses a `DATABASE_URL` without
   "restore" in the database name for exactly this reason, and separately
   refuses to touch Redis at all unless `--confirm-redis-namespace` and
   `--confirm-redis-host` each retype the exact `REDIS_NAMESPACE` and
   `REDIS_URL` host in use.
5. Always run step 6, even after a failure partway through.
