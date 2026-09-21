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

| Package                      | Responsibility                                                                                                                                                                                                                                                                      | May depend on                                                            | Owner role        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------- |
| `apps/web`                   | Delivery: routes, sessions of UI, health endpoints, process lifecycle, authentication composition (`features/auth` server factory plus the reserved `lib/auth-client.ts` React client; no `/api/auth` route or server entrypoint exists until auth activation — ADR 0017, ADR 0020) | protocol, engine, auth, errors, config, db, redis, logger, observability | web/product teams |
| `packages/debate-engine`     | Debate domain runtime; Adobe ECS lives behind its private adapter                                                                                                                                                                                                                   | protocol, errors                                                         | domain engineers  |
| `packages/protocol`          | Portable versioned commands, events, snapshots, stable error codes                                                                                                                                                                                                                  | errors (codes), zod                                                      | protocol owner    |
| `packages/db`                | Drizzle schema, migrations, transactional record adapters                                                                                                                                                                                                                           | config, errors                                                           | platform/data     |
| `packages/redis`             | Namespaced ephemeral key operations and lifecycle                                                                                                                                                                                                                                   | config, errors                                                           | platform/data     |
| `packages/auth`              | Principal/permission vocabulary (`debate:create`, `debate:read`, `debate:manage`; each stands alone, none implies another); trusted authentication adapters plug here; never imports Better Auth or any framework (ADR 0017)                                                        | errors                                                                   | identity owner    |
| `packages/errors`            | Error codes and the public/internal error mapping                                                                                                                                                                                                                                   | —                                                                        | platform          |
| `packages/config`            | Typed environment schemas: server, browser, test                                                                                                                                                                                                                                    | zod                                                                      | platform          |
| `packages/clock`             | Injected clock and identity primitives; public exports: `Clock`, `IdGenerator`, `systemClock`, `systemId`, `fixedClock`, `sequentialId`                                                                                                                                             | —                                                                        | platform          |
| `packages/logger`            | Structured logging facade over pino with redaction                                                                                                                                                                                                                                  | pino                                                                     | platform          |
| `packages/observability`     | Spans, trace/request correlation, timeouts                                                                                                                                                                                                                                          | logger, `@opentelemetry/api`                                             | platform          |
| `packages/typescript-config` | Shared strict tsconfig                                                                                                                                                                                                                                                              | —                                                                        | platform          |

New packages need: responsibility, explicit `exports`, allowed dependencies,
an owner, tests, and a row in this table (`docs/development/extending.md`).

## State and runtime semantics

- **PostgreSQL** owns durable competitive truth: users, debates, ballots,
  ratings, tournaments, recording metadata. Rows are persistence
  representations, never ECS entities or domain objects.
- **Redis** is expendable: presence, queues, rate limits, ephemeral room
  state. Keys are `<namespace>:v1:<validated-segment>` with mandatory expiry.
- **Process-local state** is limited to connection pools, the logger,
  shutdown-draining flags (held on `globalThis` to survive dev reloads), and
  the UI shell store snapshot described next. Anything that must coordinate
  across instances lives in PostgreSQL or Redis.
- **UI shell store** (`apps/web/src/ui/store/store.ts`) keeps its snapshot in
  a module-level `let state`. The module is `'use client'`, but client
  modules also execute during server rendering, so on the server that
  variable is one process-wide value shared by every request, not per-user
  state. It is safe today only because it holds static mock content seeded
  deterministically by `createInitialState()`. Constraints: call `setUiState`
  only from client event handlers and effects, never during render or from
  server code; never seed or mutate it on the server with per-user or
  per-request data, because that would bleed one request's state into
  another's HTML. Real per-request state must first move behind a
  request-scoped provider (ADR 0024, constraint 4).
- **Debate runtime state** is in-memory scratch. Durable operations load the
  authoritative snapshot from PostgreSQL, run a domain operation, and persist
  with an explicit concurrency policy (optimistic version today).

## Layering rules

1. Route handlers are transport: validate input, resolve the principal, call
   a feature operation, map errors. No domain rules in routes.
2. Feature operations (`apps/web/src/features/<name>/`) own orchestration:
   validation, authorization, engine calls, adapter calls, logging context.
   Authorization runs before any adapter access and names the permission
   that matches the action: the foundation proof gates creation on
   `debate:create` and reads on `debate:read`, and its service principal
   holds exactly those two.
3. Domain invariants live in `@daisy/debate-engine`; adapters never decide
   domain rules.
4. Shared UI only becomes shared when two real consumers exist.
5. Client UI shell state (`apps/web/src/ui/`) lives in an in-house,
   eval-free observable store (ADR 0024): immutable snapshots flow down,
   void transactions flow up. Adobe vendor imports stay confined to the
   engine adapter; client-side ECS is rejected — its codegen requires
   `unsafe-eval`, conflicting with the strict CSP.

Detailed documents: persistence and Redis semantics
(`docs/architecture/persistence.md`), engine boundary
(`docs/domains/engine.md`), decision records (`docs/decisions/`).
