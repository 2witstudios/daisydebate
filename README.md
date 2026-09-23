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
bun dev:agent
```

`bun dev:agent` runs `bun slot:up` (the shared Compose services plus this
checkout's migrated dev and test databases), loads the deterministic
development seed, starts the web app, waits for readiness, and prints the
local URL, seeded development identities, and seed version. Use `bun dev`
when `bun slot:up` has already run; integration tests need nothing more.

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
bun check              # pre-push gate: static, policy, duplication, unit, and build gates (catalog: AGENTS.md)
bun run duplication    # copy-paste tripwire: fails on any clone not in .jscpd-baseline.json (ADR 0026)
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
