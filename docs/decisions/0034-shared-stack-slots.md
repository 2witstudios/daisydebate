# 0034: One shared local stack with derived per-checkout slots

Status: accepted (PAR-2). Supersedes the per-session Compose stacks that
`docs/development/local-development.md` and `parallel-work.md` described
(PAR-1).

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
  `E2E_REDIS_URL`, `E2E_REDIS_NAMESPACE`, `PORT`, `PUBLIC_APP_URL` and
  `E2E_PORT`. Host, port and credentials are kept from the existing URLs, so
  the admin connection is whatever the `.env` names. A worktree's ports come
  from a port block claimed in the comment on its dev database: shared by
  every checkout and deleted with the database.
- **`bun slot:down`** drops the worktree's databases and deletes its Redis
  keys. It refuses the main checkout.
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
