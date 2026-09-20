# Architecture overview

Modular monolith: one deployable Next.js application over one PostgreSQL
database and one Redis, with the debate domain isolated in framework-free
packages. Boundaries exist so that realtime servers, matchmaking, tournament,
media, and AI workers — or non-TypeScript services — can be extracted later
without rewriting domain contracts.

## Dependency direction

```text
apps/web (Next.js delivery, feature-local application operations)
    ↓
features (application operations: validation, principals, orchestration)
    ↓
@daisy/debate-engine (domain)   @daisy/protocol (portable versioned JSON)
    ↓                                  ↓
@daisy/errors, @daisy/auth (inward-facing contracts)
    ↓
@daisy/db (PostgreSQL adapter)   @daisy/redis (ephemeral adapter)
    ↓
@daisy/config  @daisy/logger  @daisy/observability  @daisy/typescript-config
```

Infrastructure adapters point inward. The domain never imports Next, React,
Drizzle, Bun SQL, Redis, or HTTP. Enforced mechanically by
`eslint.config.mjs` and `scripts/check-boundaries.ts` (declared dependencies,
acyclic graph, explicit exports, Adobe isolation).

## Package map and ownership

| Package                      | Responsibility                                                                                                                                                                            | May depend on                                                            | Owner role        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------- |
| `apps/web`                   | Delivery: routes, sessions of UI, health endpoints, process lifecycle, authentication composition (`features/auth`; narrow `lib/auth.ts` / `lib/auth-client.ts` entrypoints per ADR 0017) | protocol, engine, auth, errors, config, db, redis, logger, observability | web/product teams |
| `packages/debate-engine`     | Debate domain runtime; Adobe ECS lives behind its private adapter                                                                                                                         | protocol, errors                                                         | domain engineers  |
| `packages/protocol`          | Portable versioned commands, events, snapshots, stable error codes                                                                                                                        | errors (codes), zod                                                      | protocol owner    |
| `packages/db`                | Drizzle schema, migrations, transactional record adapters                                                                                                                                 | config, errors                                                           | platform/data     |
| `packages/redis`             | Namespaced ephemeral key operations and lifecycle                                                                                                                                         | config, errors                                                           | platform/data     |
| `packages/auth`              | Principal/permission vocabulary; trusted authentication adapters plug here; never imports Better Auth or any framework (ADR 0017)                                                         | errors                                                                   | identity owner    |
| `packages/errors`            | Error codes and the public/internal error mapping                                                                                                                                         | —                                                                        | platform          |
| `packages/config`            | Typed environment schemas: server, browser, test                                                                                                                                          | zod                                                                      | platform          |
| `packages/clock`             | Injected clock and identity primitives; public exports: `Clock`, `IdGenerator`, `systemClock`, `systemId`, `fixedClock`, `sequentialId`                                                   | —                                                                        | platform          |
| `packages/logger`            | Structured logging facade over pino with redaction                                                                                                                                        | pino                                                                     | platform          |
| `packages/observability`     | Spans, trace/request correlation, timeouts                                                                                                                                                | logger, `@opentelemetry/api`                                             | platform          |
| `packages/typescript-config` | Shared strict tsconfig                                                                                                                                                                    | —                                                                        | platform          |

New packages need: responsibility, explicit `exports`, allowed dependencies,
an owner, tests, and a row in this table (`docs/development/extending.md`).

## State and runtime semantics

- **PostgreSQL** owns durable competitive truth: users, debates, ballots,
  ratings, tournaments, recording metadata. Rows are persistence
  representations, never ECS entities or domain objects.
- **Redis** is expendable: presence, queues, rate limits, ephemeral room
  state. Keys are `<namespace>:v1:<validated-segment>` with mandatory expiry.
- **Process-local state** is limited to connection pools, the logger, and
  shutdown-draining flags (held on `globalThis` to survive dev reloads).
  Anything that must coordinate across instances lives in PostgreSQL or Redis.
- **Debate runtime state** is in-memory scratch. Durable operations load the
  authoritative snapshot from PostgreSQL, run a domain operation, and persist
  with an explicit concurrency policy (optimistic version today).

## Layering rules

1. Route handlers are transport: validate input, resolve the principal, call
   a feature operation, map errors. No domain rules in routes.
2. Feature operations (`apps/web/src/features/<name>/`) own orchestration:
   validation, authorization, engine calls, adapter calls, logging context.
3. Domain invariants live in `@daisy/debate-engine`; adapters never decide
   domain rules.
4. Shared UI only becomes shared when two real consumers exist.

Detailed documents: persistence and Redis semantics
(`docs/architecture/persistence.md`), engine boundary
(`docs/domains/engine.md`), decision records (`docs/decisions/`).
