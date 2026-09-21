# Local development

Prerequisites: Bun 1.4.2 (`.bun-version` pins it), Docker with Compose, Node
24 (Playwright driver only), PostgreSQL/Redis via the provided Compose stack.

```sh
git clone <repo> && cd daisydebate
bun install --frozen-lockfile
cp .env.example .env
bun dev:agent       # infra, migration, deterministic seed, web, readiness
```

`bun dev:agent` is the clean-environment path. It starts PostgreSQL and Redis,
applies migrations, upserts the fixed local seed and its durable version marker,
launches the existing web development task, waits for `/api/health/ready`, and
prints the web URL, seeded development identities, and seed version. It does
not print database URLs or passwords. Use `bun dev` when the services and
database are already prepared.

Migrate the test database once for integration tests:

```sh
set -a; source .env; set +a
DATABASE_URL="$TEST_DATABASE_URL" bun db:migrate
```

## Commands

| Command                           | What it does                                                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `bun dev`                         | All dev processes (currently the web app) via turbo                                                                   |
| `bun dev:agent`                   | Start local dependencies, migrate, seed, launch web, and wait ready                                                   |
| `bun build`                       | Production builds through the turbo graph                                                                             |
| `bun test`                        | Fast deterministic unit/domain tests; no services or Next boot                                                        |
| `bun test:integration`            | Database, Redis, and web vertical tests against real services                                                         |
| `bun test:e2e`                    | Playwright against the production server build                                                                        |
| `bun verify`                      | `bun check` plus migration-idempotency, integration, and E2E gates                                                    |
| `bun lint`                        | ESLint plus `scripts/check-boundaries.ts` architecture verification                                                   |
| `bun format` / `bun format:check` | Prettier write / verify                                                                                               |
| `bun typecheck`                   | `tsc --noEmit` per workspace (web runs `next typegen` first)                                                          |
| `bun check`                       | format:check + lint + policy + knip + invariants + evidence + typecheck + test + metrics + build — run before pushing |
| `bun check:affected`              | Fast per-vertical inner loop: lint/prettier on changed files, boundaries, affected turbo graph                        |
| `bun hooks:install`               | One-time opt-in: point `core.hooksPath` at `.githooks` so `git push` runs `bun check:affected`                        |
| `bun migrations:check`            | Fail a branch that rewrites/edits/reorders shared migrations vs `origin/main`                                         |
| `bun evidence`                    | Orphan-suite and CI-wiring audit: every test tier is claimed by a real runner                                         |
| `bun db:generate`                 | Generate migration SQL from schema changes (review the SQL!)                                                          |
| `bun db:migrate`                  | Apply pending migrations                                                                                              |
| `bun db:seed`                     | Idempotently upsert the deterministic agent seed and version marker                                                   |
| `bun db:studio`                   | Drizzle Studio (local only, never expose)                                                                             |
| `bun infra:up/down/logs`          | Compose lifecycle for PostgreSQL and Redis                                                                            |

## Environment

`.env` (git-ignored) mirrors `.env.example`. Server configuration is parsed
by `@daisy/config` and fails fast on invalid or insecure values — production
refinements reject HTTP public URLs, development credentials, missing
deployment identity, and the development-only proof flag. The Compose
PostgreSQL is exposed on host port `15432` to coexist with host-level
Postgres installs; `.env.example` matches.

Authentication variables (`BETTER_AUTH_SECRET`, `RESEND_API_KEY`,
`AUTH_EMAIL_FROM`) are documented in `.env.example` and validated only when
the auth composition activates — baseline startup and `bun doctor` never
require them. Run `bun auth:provision` to generate a 64-character
`BETTER_AUTH_SECRET` into `.env` whenever a canonical
`BETTER_AUTH_SECRET=<value>` assignment is missing. A canonical value is
always preserved; non-canonical but loader-supported assignments
(`export BETTER_AUTH_SECRET=…`, `BETTER_AUTH_SECRET = …`) rotate: the
generated value is appended as the final assignment (dotenv last-assignment
semantics), the stale line is left untouched, and repeated runs are no-ops.
The value is never printed or committed. Live email delivery additionally
needs owner-provisioned Resend credentials.

## Parallel sessions on one machine

Multiple local sessions (git worktrees, `pu` slots) share nothing when each
pins its own Compose stack. Give every session a distinct
`DAISY_STACK_NAME` and host ports, then point its URLs at those ports — the
knobs are ordinary `.env` values, and Compose reads them through
`--env-file .env` (see `infra/compose.yaml`):

```sh
cp .env.example .env
# In the slot's .env:
#   DAISY_STACK_NAME=daisy-slot2   distinct containers + volumes per stack
#   DAISY_PG_PORT=25432            Postgres host port (DB names stay the same)
#   DAISY_REDIS_PORT=26379         Redis host port
#   PORT=3001 PUBLIC_APP_URL=http://localhost:3001
#   E2E_PORT=13100 E2E_POSTGRES_PORT=25432 E2E_REDIS_PORT=26379
```

Rules that keep sessions safe:

- A distinct stack name is the isolation boundary: its containers and
  volumes are separate, so `bun infra:down` in one session cannot kill
  another session's services and databases never collide.
- An explicit `E2E_PORT` also disables Playwright's `reuseExistingServer`;
  without it a session could silently boot its suite against another
  session's already-running server.
- Unit tests need no isolation. Integration tests always scope their own
  unique identifiers and Redis namespaces, so two sessions can share one test database
  for short checks — but concurrent `bun db:migrate` or `bun verify`
  against the same `TEST_DATABASE_URL` can race; prefer one test database
  per stack.
- Generating migrations is still single-writer at a time; see
  `docs/operations/database.md` and `bun migrations:check`.

## Pre-push hook

`.githooks/pre-push` is committed but inert until you opt in, once per clone:

```sh
bun hooks:install   # git config core.hooksPath .githooks
```

After that every `git push` that sends commits first runs
`bun check:affected` against `origin/main` (run `git fetch origin` if the base
is missing) and aborts the push on failure. It deliberately runs the fast
affected gate, not the full chain: run `bun check` yourself before opening a
PR, and CI remains the enforcement of record. `core.hooksPath` lives in the
repository's shared git config, so it also applies to every worktree of that
clone; each worktree resolves `.githooks` against its own checkout. Undo with
`git config --unset core.hooksPath`; bypass a single push deliberately with
`git push --no-verify`. No hook manager (husky, lefthook) is used or wanted.

## Conventions that save review time

- Root commands are the interface; avoid package-local incantations.
- `bun --env-file=.env run turbo …` is the supported pattern when a turbo
  task needs environment variables: turbo runs in strict env mode and only
  forwards declared variables.
- Never commit `.env`, build outputs, or `.pu/` runtime files.
