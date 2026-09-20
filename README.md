# Daisy

Competitive debate with the structure of online chess: ranked debates,
matchmaking, live play, spectators, judges, ratings, tournaments, and
recordings — built to eventually host AI debaters, judges, and coaching.

**Status: production foundation.** Product routes are shells; the
architecture, boundaries, infrastructure, and verification loops are real.

## Stack

Bun 1.4.2 · TypeScript (strict) · Turborepo · Next.js (App Router) ·
React · PostgreSQL 18 + Drizzle · Redis 8 (Bun native client) · Adobe Data
ECS (behind the domain boundary) · Zod · Pino · OpenTelemetry API ·
Playwright · Docker Compose · GitHub Actions.

## Quick start

```sh
bun install --frozen-lockfile
cp .env.example .env
bun infra:up
bun db:migrate
bun dev
```

Then `DATABASE_URL="$TEST_DATABASE_URL" bun db:migrate` (with `.env`
sourced) to enable integration tests.

## Where work belongs

| You are building…                    | It lives in…                                               |
| ------------------------------------ | ---------------------------------------------------------- |
| A product feature (ranked, lobby, …) | `apps/web/src/features/<feature>/` + routes in `src/app`   |
| Domain rules of debate               | `packages/debate-engine` (contracts via `@daisy/protocol`) |
| Portable messages/snapshots          | `packages/protocol`                                        |
| Durable records, migrations          | `packages/db`                                              |
| Ephemeral coordination               | `packages/redis`                                           |
| Cross-cutting platform concerns      | `config`, `errors`, `logger`, `observability`, `auth`      |

Agents: read `AGENTS.md` first — it is the binding engineering contract.

## Verification

```sh
bun check              # format, lint+boundaries, typecheck, unit tests, build
bun invariants         # execute every registered domain invariant fixture
bun verify             # bun check plus migration, integration, and browser gates
bun test:integration   # real PostgreSQL/Redis + web vertical proof
bun test:e2e           # production-mode browser suite (Playwright)
```

## Documentation

- `docs/architecture/overview.md` — boundaries, package map, ownership
- `docs/architecture/persistence.md` — PostgreSQL/Redis semantics
- `docs/dependencies.md` — why every major dependency exists, and its docs
- `docs/decisions/` — ADRs (tradeoffs, not just outcomes)
- `docs/development/` — local setup, testing, extension recipes
- `docs/operations/` — database and production runbooks
- `CONTRIBUTING.md` — workflow and review expectations
