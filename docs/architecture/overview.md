# Architecture overview

Modular monolith: `apps/web` (Next.js) and `apps/realtime` (native
`Bun.serve` WebSocket) are two deployments over one PostgreSQL database and
one Redis, with the debate domain isolated in framework-free packages.
Boundaries exist so that matchmaking, tournament, media, and AI workers — or
non-TypeScript services — can be extracted later without rewriting domain
contracts.

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

| Package                      | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                   | May depend on                                                                                                    | Owner        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------ |
| `apps/web`                   | Delivery: routes, sessions of UI, health endpoints, process lifecycle, authentication composition (`features/auth` server factory mounted at `/api/auth` and `/auth/confirm`, the reserved `lib/auth-client.ts` React client, `lib/identity.ts` session-to-Principal glue, `features/access` route guards and `features/account` username claim — ADR 0017, ADR 0020)                                            | protocol, engine, auth, errors, config, db, redis, logger, observability                                         | @2witstudios |
| `apps/realtime`              | Realtime delivery, a second deployment (ADR 0031): socket authentication with first-message tickets, subscription authorization, outbox fan-out over native `Bun.serve` WebSocket, and social presence; no domain logic, media or jobs                                                                                                                                                                           | protocol, auth, db (SELECT plus `service_instances` writes), redis, clock, config, errors, logger, observability | @2witstudios |
| `packages/debate-engine`     | Debate domain runtime; Adobe ECS lives behind its private adapter                                                                                                                                                                                                                                                                                                                                                | protocol, errors                                                                                                 | @2witstudios |
| `packages/protocol`          | Portable versioned commands, events, snapshots, stable error codes                                                                                                                                                                                                                                                                                                                                               | errors (codes), zod                                                                                              | @2witstudios |
| `packages/db`                | Drizzle schema, migrations, transactional record adapters; CHECK vocabularies derive from protocol enums (ADR 0029)                                                                                                                                                                                                                                                                                              | config, errors, protocol                                                                                         | @2witstudios |
| `packages/redis`             | Namespaced ephemeral key operations and lifecycle                                                                                                                                                                                                                                                                                                                                                                | config, errors, protocol                                                                                         | @2witstudios |
| `packages/auth`              | Principal/permission vocabulary (`debate:create`, `debate:read`, `debate:manage`; each stands alone, none implies another), the username rule, and `resolveIdentity` (verified session facts → anonymous / provisional / member Principal; members hold `debate:create` only); trusted authentication adapters plug in through an injected session reader; never imports Better Auth or any framework (ADR 0017) | errors                                                                                                           | @2witstudios |
| `packages/errors`            | Error codes and the public/internal error mapping                                                                                                                                                                                                                                                                                                                                                                | —                                                                                                                | @2witstudios |
| `packages/config`            | Typed environment schemas: server, browser, test                                                                                                                                                                                                                                                                                                                                                                 | zod                                                                                                              | @2witstudios |
| `packages/clock`             | Injected clock and identity primitives; public exports: `Clock`, `IdGenerator`, `systemClock`, `systemId`, `fixedClock`, `sequentialId`                                                                                                                                                                                                                                                                          | —                                                                                                                | @2witstudios |
| `packages/logger`            | Structured logging facade over pino with redaction                                                                                                                                                                                                                                                                                                                                                               | pino                                                                                                             | @2witstudios |
| `packages/observability`     | Spans, trace/request correlation, timeouts                                                                                                                                                                                                                                                                                                                                                                       | logger, `@opentelemetry/api`                                                                                     | @2witstudios |
| `packages/typescript-config` | Shared strict tsconfig                                                                                                                                                                                                                                                                                                                                                                                           | —                                                                                                                | @2witstudios |

New packages need: responsibility, explicit `exports`, allowed dependencies,
an owner, tests, and a row in this table (`docs/development/extending.md`).
`apps/realtime` pre-declares a dependency edge on `packages/presence` (not
created yet) in `scripts/boundaries-rules.ts` per ADR 0031 §12, so the
boundary check needs no change when a later realtime leaf adds the
package; this map lists only packages that exist today.

## State and runtime semantics

- **PostgreSQL** owns durable competitive truth: users, debates, ballots,
  ratings, tournaments, recording metadata. Rows are persistence
  representations, never ECS entities or domain objects.
- **Redis** is expendable: presence, queues, rate limits, ephemeral room
  state. Keys are `<namespace>:v1:<validated-segment>` with mandatory expiry.
- **Process-local state** is limited to one composed app per process
  (connection pools, the logger, auth and the draining flag) and the UI shell
  store snapshot described next. Anything that must coordinate across
  instances lives in PostgreSQL or Redis.
- **Composition root.** `createApp({ env, fetch, clock, ids })`
  (`apps/web/src/server/app.ts`) validates configuration and builds the
  logger, database, Redis, auth, rate limiter, mail and webhook for one app;
  `createRoutes(app)` builds every route handler from it. Route handlers,
  feature operations and pages receive what they need as arguments. Exactly
  one module per app reads `process.env` or `globalThis`, its process edge:
  `apps/web/src/server/process-app.ts` keeps the process's app on
  `globalThis` (Next loads route modules, the proxy and instrumentation as
  bundles that share only that) and binds each `app/**/route.ts` export to
  it; `apps/realtime/src/start.ts` builds `createRealtimeApp`. ESLint
  enforces the edge (ISSUE-7), and tests build their own apps.
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
6. Styling (`apps/web/src/ui/`, `apps/web/src/app/`) is token-locked Tailwind
   v4 (ADR 0028): utilities in the markup, a CSS-only theme that resets the
   default namespaces and maps only Daisy tokens, a build-time stylesheet
   only (no inline styles under the nonce CSP), and lint, format and
   repository gates that fail on arbitrary values, unknown classes and
   `dark:` variants.

Detailed documents: persistence and Redis semantics
(`docs/architecture/persistence.md`), engine boundary
(`docs/domains/engine.md`), decision records (`docs/decisions/`).
