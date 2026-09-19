# Local development

Prerequisites: Bun 1.4.2 (`.bun-version` pins it), Docker with Compose, Node
24 (Playwright driver only), PostgreSQL/Redis via the provided Compose stack.

```sh
git clone <repo> && cd daisydebate
bun install --frozen-lockfile
cp .env.example .env
bun infra:up        # postgres (host port 15432) + redis (6379), healthchecked
bun db:migrate      # applies migrations to $DATABASE_URL
bun dev             # Next.js on http://localhost:3000
```

Migrate the test database once for integration tests:

```sh
set -a; source .env; set +a
DATABASE_URL="$TEST_DATABASE_URL" bun db:migrate
```

## Commands

| Command                           | What it does                                                        |
| --------------------------------- | ------------------------------------------------------------------- |
| `bun dev`                         | All dev processes (currently the web app) via turbo                 |
| `bun build`                       | Production builds through the turbo graph                           |
| `bun test`                        | Fast deterministic unit/domain tests; no services or Next boot      |
| `bun test:integration`            | Database, Redis, and web vertical tests against real services       |
| `bun test:e2e`                    | Playwright against the production server build                      |
| `bun lint`                        | ESLint plus `scripts/check-boundaries.ts` architecture verification |
| `bun format` / `bun format:check` | Prettier write / verify                                             |
| `bun typecheck`                   | `tsc --noEmit` per workspace (web runs `next typegen` first)        |
| `bun check`                       | format:check + lint + typecheck + test + build — run before pushing |
| `bun db:generate`                 | Generate migration SQL from schema changes (review the SQL!)        |
| `bun db:migrate`                  | Apply pending migrations                                            |
| `bun db:studio`                   | Drizzle Studio (local only, never expose)                           |
| `bun infra:up/down/logs`          | Compose lifecycle for PostgreSQL and Redis                          |

## Environment

`.env` (git-ignored) mirrors `.env.example`. Server configuration is parsed
by `@daisy/config` and fails fast on invalid or insecure values — production
refinements reject HTTP public URLs, development credentials, missing
deployment identity, and the development-only proof flag. The Compose
PostgreSQL is exposed on host port `15432` to coexist with host-level
Postgres installs; `.env.example` matches.

## Conventions that save review time

- Root commands are the interface; avoid package-local incantations.
- `bun --env-file=.env run turbo …` is the supported pattern when a turbo
  task needs environment variables: turbo runs in strict env mode and only
  forwards declared variables.
- Never commit `.env`, build outputs, or `.pu/` runtime files.
