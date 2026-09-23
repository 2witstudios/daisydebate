# Local development

Prerequisites: Bun 1.4.2 (`.bun-version` pins it), Docker with Compose, Node
24 (Playwright driver only), PostgreSQL/Redis via the provided Compose stack.

```sh
git clone <repo> && cd daisydebate
bun install --frozen-lockfile
cp .env.example .env
bun dev:agent       # slot:up, deterministic seed, web, readiness
```

`bun dev:agent` is the clean-environment path. It runs `bun slot:up` (shared
PostgreSQL and Redis, this checkout's dev and test databases, migrations),
upserts the fixed local seed and its durable version marker,
launches the existing web development task, waits for `/api/health/ready`, and
prints the web URL, seeded development identities, and seed version. It does
not print database URLs or passwords. Use `bun dev` when `bun slot:up` has
already run; it also migrates the test database, so integration tests need
nothing more.

## Commands

| Command                            | What it does                                                                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `bun dev`                          | All dev processes (currently the web app) via turbo                                                                                 |
| `bun dev:agent`                    | Start local dependencies, migrate, seed, launch web, and wait ready                                                                 |
| `bun build`                        | Production builds through the turbo graph                                                                                           |
| `bun test`                         | Fast deterministic unit/domain tests; no services or Next boot                                                                      |
| `bun test:integration`             | Database, Redis, and web vertical tests against real services                                                                       |
| `bun visual:server`                | Linux Playwright browser server for screenshot parity on non-Linux hosts (see testing)                                              |
| `bun test:e2e`                     | Playwright against the production server build                                                                                      |
| `bun verify`                       | `bun check` plus migration-idempotency, integration, and E2E gates                                                                  |
| `bun lint`                         | ESLint (incl. Tailwind token rules), `scripts/check-boundaries.ts`, and `scripts/check-styling.ts`                                  |
| `bun format` / `bun format:check`  | Prettier write / verify                                                                                                             |
| `bun typecheck`                    | `tsc --noEmit` per workspace (web runs `next typegen` first)                                                                        |
| `bun check`                        | format:check + lint + policy + knip + duplication + invariants + evidence + typecheck + test + metrics + build — run before pushing |
| `bun check:affected`               | Fast per-vertical inner loop: lint/prettier on changed files, boundaries, duplication, affected turbo graph                         |
| `bun hooks:install`                | One-time opt-in: point `core.hooksPath` at `.githooks` so `git push` runs `bun check:affected`                                      |
| `bun migrations:check`             | Fail a branch that rewrites/edits/reorders shared migrations vs `origin/main`                                                       |
| `bun run duplication`              | Copy-paste tripwire (jscpd): fails on any clone absent from `.jscpd-baseline.json` (ADR 0026)                                       |
| `bun evidence`                     | Orphan-suite and CI-wiring audit: every test tier is claimed by a real runner                                                       |
| `bun db:generate`                  | Generate migration SQL from schema changes (review the SQL!)                                                                        |
| `bun db:migrate`                   | Apply pending migrations                                                                                                            |
| `bun db:seed`                      | Development fixture: idempotently upsert the agent users, actors and seed debate, refresh the `foundation` format, mark versions    |
| `bun db:studio`                    | Drizzle Studio (local only, never expose)                                                                                           |
| `bun slot:up`                      | Shared stack up, prune orphans, create and migrate this checkout's databases, write its `.env` slot values (idempotent)             |
| `bun slot:down` / `bun slot:prune` | Drop this worktree's databases and Redis keys / those of worktrees git no longer lists                                              |
| `bun db:reset`                     | Recreate and re-migrate one of this checkout's own databases (`ALLOW_DATABASE_RESET=yes`)                                           |
| `bun infra:logs`                   | Follow the shared stack's Compose logs                                                                                              |

## Environment

`.env` (git-ignored) mirrors `.env.example`. Server configuration is parsed
by `@daisy/config` and fails fast on invalid or insecure values — production
refinements reject HTTP public URLs, development credentials, missing
deployment identity, and the development-only proof flag. The Compose
PostgreSQL is exposed on host port `15432` to coexist with host-level
Postgres installs; `.env.example` holds the main checkout's slot values and
`bun slot:up` rewrites them in a worktree.

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
needs owner-provisioned Resend credentials. The optional
`AUTH_TRUSTED_IP_HEADERS` and `AUTH_TRUSTED_PROXIES` lists declare which
proxy-overwritten header names the client address for auth rate limiting;
leave them unset locally (no header is believed). See
[production operations](../operations/production.md#releases).

## Parallel sessions on one machine

Every checkout on the machine (the main checkout and each git worktree or
`pu` slot) uses the same local stack: one Postgres on `15432`, one Redis on
`6379`, Compose project `daisy`. What separates sessions is the **slot**,
which `bun slot:up` derives from the checkout folder
([ADR 0034](../decisions/0034-shared-stack-slots.md)):

| Checkout                      | Databases                                     | Redis namespaces                             | Ports (app, e2e)               |
| ----------------------------- | --------------------------------------------- | -------------------------------------------- | ------------------------------ |
| Main checkout                 | `daisy`, `daisy_test`                         | `daisy`, `daisy-e2e`                         | 3000, 3100                     |
| Worktree folder `wt-3ctbm0tw` | `daisy_wt_3ctbm0tw`, `daisy_wt_3ctbm0tw_test` | `daisy-wt-3ctbm0tw`, `daisy-wt-3ctbm0tw-e2e` | 13000+10n, 13001+10n (block n) |

In a new worktree, copy the main checkout's `.env` (or `.env.example`) and
run `bun slot:up`. It is idempotent:

- brings the shared stack up (`docker compose up -d --wait`);
- prunes orphans: the databases and Redis keys of worktrees that
  `git worktree list` no longer shows;
- creates this checkout's dev and test databases from `daisy_template` if
  missing, and migrates both with this branch's migrations;
- writes the slot's `DATABASE_URL`, `TEST_DATABASE_URL`, `REDIS_NAMESPACE`,
  `E2E_DATABASE_URL`, `E2E_REDIS_URL`, `E2E_REDIS_NAMESPACE`, `PORT`,
  `PUBLIC_APP_URL` and `E2E_PORT` into `.env`, keeping host, port and
  credentials. A worktree's port block is claimed on its dev database, so
  no two checkouts get the same ports.

Rules that keep sessions safe:

- Never hand-edit slot values. `bun doctor` fails when `.env` names another
  slot's database or namespace (typically a `.env` copied from the main
  checkout without `bun slot:up`) and warns about orphaned slots.
- `bun slot:down` drops a worktree's databases and Redis keys; run it at
  handoff when no reviewer needs the data. It refuses the main checkout.
  `bun slot:prune` removes every orphaned slot; removing a worktree without
  either leaves its data only until the next `slot:up` anywhere.
- Never stop, recreate or reconfigure the shared stack while other
  checkouts use it; there is deliberately no `infra:down`.
- The browser suite uses three consecutive ports from `E2E_PORT` (the
  production app, its loopback TLS edge `https://localhost:<E2E_PORT+1>`,
  and the mail capture). A pinned `E2E_PORT` also disables Playwright's
  `reuseExistingServer`, so a session never tests another session's server.
- `bun db:reset` accepts only this checkout's own two databases.
- Generating migrations is still single-writer at a time; see
  `docs/operations/database.md` and `bun migrations:check`.

## Pre-push hook

`.githooks/pre-push` is committed but inert until you opt in, once per clone:

```sh
bun hooks:install   # git config core.hooksPath .githooks
```

After that every `git push` that sends commits first runs
`bun check:affected` against `origin/main` (run `git fetch origin` if the base
is missing) and aborts the push on failure.

`bun check:affected` inspects the checked-out working tree, so the hook can
only vouch for `HEAD`. It classifies every ref git reports for the push:

| Pushed ref                                                       | Behavior                                             |
| ---------------------------------------------------------------- | ---------------------------------------------------- |
| Branch deletion                                                  | Allowed; nothing is sent                             |
| Branch or tag (annotated tags are peeled) whose commit is `HEAD` | Verified; the check runs once per push               |
| Commit already contained in a remote-tracking branch             | Allowed with a notice; nothing new is sent           |
| Any other commit (non-checked-out branch, old unpushed tag)      | Push refused: check that ref out and push from there |

One refused ref refuses the whole push, including multi-ref pushes. The check
covers the working tree, so the hook prints a notice when uncommitted changes
are present; commit or set them aside if you want the result to describe
exactly the pushed commit.

The hook deliberately runs the fast
affected gate (changed-file lint/prettier, boundaries, the repo-wide
duplication gate, affected typecheck/tests), not the full chain: run `bun check` yourself before opening a
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
