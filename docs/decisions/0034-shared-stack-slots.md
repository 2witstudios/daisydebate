# 0034: One shared local stack with derived per-checkout slots

Status: accepted (PAR-2). Supersedes the per-session Compose stacks that
`docs/development/local-development.md` and `parallel-work.md` described
(PAR-1). Amended by [ADR 0038](0038-drizzle-1-baseline.md): each slot
has a third database for the browser suite, the template database is
gone (slot databases copy `template0`), and the e2e login's access is its
membership in `daisy_web`.

## Context

Parallel sessions each started their own Compose project, named by hand
(a chosen stack name and custom ports). Nothing tore a project down: removing a
worktree left its containers and volume behind, and nothing linked a
hand-picked stack name back to its worktree. On 2026-09-22 two of five
running stacks had no owner, 13 orphaned Postgres volumes held about 1.9 GB,
and five of eight worktrees had set no stack name at all, so they silently
shared (and restarted) the main checkout's stack. The databases themselves
are tiny (`daisy` 9 MB, `daisy_test` 15 MB).

## Decision

- **One stack.** `infra/compose.yaml` has the fixed project name `daisy` and
  fixed loopback ports (Postgres 15432, Redis 6379). Postgres runs with
  `max_connections=300` because every checkout's dev server, test pools and
  e2e server share it. There are no stack-name or port knobs.
- **Slots are derived, never chosen.** A checkout's slot comes from its
  folder (`scripts/slot-model.ts`, a pure tested function). The main
  checkout is slot `daisy`: databases `daisy` and `daisy_test`, Redis
  namespaces `daisy` and `daisy-e2e`. A git worktree folder such as
  `wt-3ctbm0tw` is slot `3ctbm0tw`: databases `daisy_wt_3ctbm0tw` and
  `daisy_wt_3ctbm0tw_test`, namespaces `daisy-wt-3ctbm0tw` and
  `daisy-wt-3ctbm0tw-e2e`. Ids are lowercase words joined by single
  underscores, at most 28 characters so every namespace fits
  `REDIS_NAMESPACE`, and may not end in `_test` or `_e2e`, so every
  database and namespace name maps back to exactly one slot. Any other
  folder name is refused, never normalised into something else.
- **Template database.** `daisy_template` holds what a fresh slot needs
  before migrations: the `daisy_e2e` role's schema usage and default table
  and sequence privileges. It accepts no connections, so copying from it
  never fails with "source database is being accessed". It holds no schema:
  each slot runs its own branch's migrations. `bun slot:up` creates the role
  and the template when missing; there is no Docker init script, so one
  code path sets up new and existing volumes alike.
- **`bun slot:up`** (idempotent) brings the shared stack up, prunes orphans,
  creates the slot's databases from the template, migrates both, and writes
  the slot's values into the checkout's `.env`: `DATABASE_URL`,
  `TEST_DATABASE_URL`, `REDIS_NAMESPACE`, `E2E_DATABASE_URL`,
  `E2E_REDIS_URL`, `E2E_REDIS_NAMESPACE`, `TEST_REDIS_URL`, `PORT`,
  `PUBLIC_APP_URL` and `E2E_PORT`. Host, port and credentials are kept from the existing URLs, so
  the admin connection is whatever the `.env` names. A worktree's ports come
  from a port block claimed in the comment on its dev database: shared by
  every checkout and deleted with the database.
- **`bun slot:down`** drops the worktree's databases and deletes its Redis
  keys, including every `t3-` namespace in its test Redis database. It refuses the main checkout.
- **`bun slot:prune`** (and the start of every `slot:up`) drops the
  `daisy_wt_*` databases and `daisy-wt-*` namespaces of worktrees that
  `git worktree list` no longer shows (a `prunable` entry, whose folder is
  gone, counts as removed). Names that do not parse as a worktree slot are
  never touched. Redis keys are removed with `SCAN` and `UNLINK` over the
  exact `<namespace>:*` pattern, never `FLUSHDB`/`FLUSHALL`.
- **Local stack only.** Slot tooling force-drops databases and unlinks
  namespaces, so it refuses a `.env` whose `DATABASE_URL`, `REDIS_URL` or
  `E2E_REDIS_URL` names anything but loopback, before touching Docker or
  any service.
- **Each checkout migrates itself.** `slot:up` runs the selected checkout's
  own `packages/db/scripts/migrate.ts`, so a branch behind or ahead of the
  one running the tool gets exactly its own schema.
- **Identifiers are allowlisted.** Database names and literals in
  `CREATE`/`DROP`/`COMMENT`/`CREATE ROLE` cannot be bound as parameters;
  `@daisy/db/slots` checks each against a strict pattern before quoting it,
  and `@daisy/redis/namespaces` refuses any namespace with glob or separator
  characters.
- **Guards.** `bun doctor` fails when `.env` names another slot's database
  or namespace (a `.env` copied from the main checkout) and warns about
  orphaned slots. `bun db:reset` accepts only the current slot's two
  databases on loopback and restores the `daisy_e2e` grants after
  recreating `public`.
- **E2E.** The Playwright config takes `E2E_DATABASE_URL`, `E2E_REDIS_URL`
  and `E2E_REDIS_NAMESPACE` explicitly (CI sets them in `e2e.yml`). A
  missing value is passed as empty and the server refuses to start, so the
  suite never falls back to another checkout's data.

## Test Redis: one logical database per slot (ISSUE-237)

On 2026-09-29 the test Redis (database 1, shared by every checkout) held
78,208 stale `t3-*` keys from 85 runs. Teardown and every SCAN walk the whole
keyspace, so they slowed with other people's keys until the namespaces
SCAN test timed out and blocked other checkouts' `bun verify`. ISSUE-192 made
a normal teardown delete its namespace; a crashed, killed or timed-out run
still leaked, and cost still scaled with everyone else's keys. The rule is
now that leaked test state cannot happen, by three mechanisms and one
isolation choice.

- **Isolation: a Redis logical database per slot.** Main keeps database 1
  (CI's too); a worktree slot's integration suites use database `2 + its port
block` (3 to 501), written to `TEST_REDIS_URL` by `slot:up`. The port block
  is already claimed in the slot database's comment and released when
  `slot:down` or a prune drops that database, so there is no second claim store.
  Dev (0), main's test (1) and the browser suite (2) are unchanged. A slot's
  SCAN, `deleteNamespace` and sweep walk only its own database, so their cost
  is independent of every other slot. `infra/compose.yaml` starts Redis with
  `--databases 512`; `slot:up` reads `CONFIG GET databases` and refuses a
  server with too few, naming the one-time
  `docker compose -f infra/compose.yaml up -d --force-recreate redis`.
  `slot:up` never recreates a running stack itself (that would drop every
  checkout's Redis state), so the operator runs it once. Every path that
  deletes from the test database checks that `TEST_REDIS_URL` names exactly
  the slot's own database (main 1, a worktree `2 + block`, derived from
  `PORT`) and refuses anything else, whether dev (0), e2e (2), another slot's
  or past the server's 512 (ISSUE-244): `bun doctor` reports the mismatch,
  the runner exits before its sweep or post-run scan, and `slot:down` opens
  no client, so a hand-edited `.env` can never make a run delete another
  database's keys.
- **Why not per-namespace key tracking.** Tracking each run's keys in a set
  needs every write attributed to a namespace at the seam: the presence
  scripts build a hash key inside Lua, and the slot tooling must still SCAN
  production-shaped namespaces it never tracked. The namespaces SCAN test
  would also still walk the shared keyspace, which is the cost that failed.
  A logical database removes the shared keyspace instead of indexing it.
- **Every test key expires.** `@daisy/redis/testing` wraps a client so that a
  `SET` with no expiry is sent as `SET ... PX <ceiling>` and every other write
  (a key-first command or an `EVAL`/`EVALSHA` with declared keys) is followed
  by a script capping the touched keys' TTL at the ceiling, two hours: well
  past the one-hour maximum run. A write whose keys it cannot attribute is
  refused before it is sent, and so is a client helper that could bypass the
  wrapper. `createTestApp` hands the composed app this client (`createApp`'s
  `redisClient`), and `withRedis` does the same for the package's suites.
  After every run the runner scans the database and fails, naming the keys, if
  any has no expiry, then removes them.
- **Self-healing on every run.** Every test namespace is `t3-<id>`
  (`testNamespace`). Before a workspace's suites start, the runner removes
  every `t3-` namespace whose newest key (`OBJECT IDLETIME`) has been idle
  longer than the maximum run length. A run in progress keeps a fresh key, so
  concurrent workspaces in the same slot are safe, and no other slot's
  database is touched. The rule ignores TTLs, so it also clears an immortal
  key a killed run wrote in the window between a write and its cap.
- **Release.** `slot:down` deletes the slot's `t3-` namespaces. A prune of an
  orphaned worktree does not open its test database: its keys expire within
  two hours and the next slot to claim that block sweeps any remainder.
- **Not covered here.** Postgres rows a killed run leaves in the test
  database are not swept (ISSUE-238 carries it, with the measured leak).

The proof is `bun proof:test-redis` against a throwaway Redis: 100,000
foreign keys in another slot's database leave teardown and the SCAN test
within their baseline over 10 runs, the same keys in one shared database slow
both several times over (the negative control), and a SIGKILLed run leaves
nothing that survives the next sweep.

## Consequences

- Removing a worktree leaves nothing running: its data goes on the next
  `slot:up` anywhere, or `slot:prune`, or its own `slot:down` at handoff.
- Every checkout depends on one stack; stopping it stops everyone. The
  scripts therefore offer no `infra:down`.
- The stack is per machine but pruning only knows its own repository's
  worktrees: two clones of this repository on one machine would each prune
  the other's worktree slots and share the main slot. Use worktrees of one
  clone, never a second clone.
- `slot:up` starts Compose only when the stack is unreachable, so a branch
  whose compose file differs never recreates the running shared stack;
  changing the stack's configuration is a deliberate operator step.
- Pruning reads `git worktree list` under the slot lock, so a worktree
  created and slotted while another `slot:up` waited is never pruned.
- Two worktree folders that derive the same id (`a-b` and `a_b`) are
  refused rather than allowed to share a slot.
- Migration generation is still single-writer (`bun migrations:check`); each
  slot only applies its own branch's migrations to its own databases.

## Upgrade path

Copy-on-write cloning (Postgres 18 `file_copy_method = clone`) needs a
reflink filesystem. Docker Desktop's ext4 VM is not one, and at a few MB per
database a plain template copy takes well under a second, so it is not
pursued. If slot databases grow large, move the data directory to a reflink
filesystem and set `file_copy_method = clone`; the slot model is unchanged.
