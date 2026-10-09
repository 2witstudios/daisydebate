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
@daisy/debate-engine (domain)
    ↓
@daisy/errors, @daisy/auth (inward-facing contracts)
    ↓
@daisy/protocol (portable versioned JSON; owns every shared vocabulary)
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

| Package                      | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | May depend on                                                                                                    | Owner        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------ |
| `apps/web`                   | Delivery: routes, sessions of UI, health endpoints, process lifecycle, authentication composition (`features/auth` server factory mounted at `/api/auth` and `/auth/confirm`, the reserved `lib/auth-client.ts` React client, `lib/identity.ts` session-to-Principal glue, `features/access` route guards and `features/account` username claim — ADR 0017, ADR 0020; `features/lobby` the room list over sample data behind the single `listRooms` seam — ADR 0049; `features/tournaments` every Tournaments screen over sample data, one seam per read (`listTournaments`, `getTournament`, `getBracket`, `getResults`, `getEvent`, `getConsole`, `getOrganizeDashboard`, `getDraft`) and flow drivers for registration, the event, the room, the console and the wizard; `/tournaments/enter`, `/tournaments/mine` and `/tournaments/organize` are guarded areas under the public root by longest-prefix match in `features/access` — ADR 0043, ADR 0049) | protocol, engine, auth, errors, config, db, redis, logger, observability                                         | @2witstudios |
| `apps/realtime`              | Realtime delivery, a second deployment (ADR 0031): socket authentication with first-message tickets, subscription authorization, outbox fan-out over native `Bun.serve` WebSocket, and social presence; no domain logic, media or jobs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | protocol, auth, db (SELECT plus `service_instances` writes), redis, clock, config, errors, logger, observability | @2witstudios |
| `packages/debate-engine`     | Debate domain runtime; Adobe ECS lives behind its private adapter                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | protocol, errors                                                                                                 | @2witstudios |
| `packages/ai-voice`          | AI debate voice layer (AIDB): the OpenRouter adapter for chat, speech (TTS) and transcription (STT), the debater, CX and judge prompts, and pure speech-fitting helpers; zero-data-retention routing on every call                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | debate-engine, errors                                                                                            | @2witstudios |
| `packages/protocol`          | Portable versioned snapshots, messages and payloads; the one owner of every shared vocabulary (sides, roles, error codes, topic families, presence and delivery statuses); the ballot contract every judge fills, human or AI: the speaker rubric (`speaker-10@1`), `ballotSchema`, `speakerTotal` and `isLowPointWin`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | zod                                                                                                              | @2witstudios |
| `packages/db`                | Drizzle schema, migrations, transactional record adapters; CHECK vocabularies derive from protocol enums (ADR 0029)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | config, errors, protocol                                                                                         | @2witstudios |
| `packages/redis`             | Namespaced ephemeral key operations and lifecycle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | config, errors, protocol                                                                                         | @2witstudios |
| `packages/auth`              | Shared actor-bound identity, pure authorization decisions from current account/resource/policy facts, age-band projections and request boundary contracts (ADR 0048)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | errors, protocol                                                                                                 | @2witstudios |
| `packages/errors`            | The public/internal error mapping for the protocol's error codes; test support at `@daisy/errors/testing` (`assertRejects`, `rejectionOf`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | protocol                                                                                                         | @2witstudios |
| `packages/config`            | Typed environment schemas: server, browser, and `requireTestServices` (the one integration-suite guard)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | zod                                                                                                              | @2witstudios |
| `packages/clock`             | Injected clock and identity primitives; public exports: `Clock`, `IdGenerator`, `systemClock`, `systemId`, `fixedClock`, `sequentialId`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | —                                                                                                                | @2witstudios |
| `packages/logger`            | Structured logging facade over pino, admitting only allowlisted fields (ADR 0019)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | pino; config (test only: secret keys for redaction tests)                                                        | @2witstudios |
| `packages/observability`     | Spans, trace/request correlation, timeouts, the `ErrorReporter` port and `scrubEvent` (ADR 0037; no-op default, each app supplies its own vendor adapter)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | logger, `@opentelemetry/api`                                                                                     | @2witstudios |
| `packages/typescript-config` | Shared strict tsconfig                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | —                                                                                                                | @2witstudios |

New packages need: responsibility, explicit `exports`, allowed dependencies,
an owner, tests, and a row in this table (`docs/development/extending.md`).
`apps/realtime` pre-declares a dependency edge on `packages/presence` (not
created yet) in `scripts/boundaries-rules.ts` per ADR 0031 §12, so the
boundary check needs no change when a later realtime leaf adds the
package; this map lists only packages that exist today.

## State and runtime semantics

- **PostgreSQL** owns durable competitive truth: users, Rooms, Rounds, ballots,
  ratings, tournaments, recording metadata. Rows are persistence
  representations, never ECS entities or domain objects.
- **Redis** is expendable: presence, queues, rate limits, ephemeral connection
  state. Keys are `<namespace>:v1:<validated-segment>` with mandatory expiry.
- **Process-local state** is limited to one composed app per process
  (connection pools, the logger, auth and the draining flag) and the UI shell
  store snapshot described next. Anything that must coordinate across
  instances lives in PostgreSQL or Redis.
- **Composition root.** `createApp({ env, fetch, clock, ids })`
  (`apps/web/src/server/app.ts`) validates configuration and builds the
  logger, database, Redis, auth, rate limiter, mail and webhook for one app;
  `createRoutes(app)` builds every route handler from it. Route handlers and
  feature operations receive what they need as arguments. Exactly one module
  per app reads `process.env` or `globalThis`, its process edge:
  `apps/web/src/server/process-app.ts` keeps the process's app on
  `globalThis` (Next loads route modules, the proxy and instrumentation as
  bundles that share only that) and binds each `app/**/route.ts` export to
  it; `apps/realtime/src/start.ts` builds `createRealtimeApp`. Next renders
  pages and layouts itself, so server components cannot take arguments:
  they read this request's session through `lib/request-session.ts`, the one
  non-route module that takes the process app (`processApp().auth()`) and
  passes it on to `lib/identity.ts`. Only route bindings (`processRoute`),
  that module, `proxy.ts`, `instrumentation.ts` and `server/start.ts` may
  import the edge. ESLint enforces all of this (ISSUE-7), and tests build
  their own apps.
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
- **Round runtime state** is in-memory execution scratch. Durable operations
  hydrate authoritative Round, participant and segment rows plus frozen rules
  from PostgreSQL, run a domain operation at database time, and persist its
  projection under the expected Round version.

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

## Authorization core (ADR 0048)

The shared evaluator consumes current facts rather than permissions attached to
an identity. Authentication resolves a durable user-to-human-actor binding;
account facts require verified email, a username and no erasure tombstone.

- **One pure decision point.** `@daisy/auth/authorization` owns Room collection,
  Room operations, persisted Round reads and messaging capabilities. Delivery
  composes `@daisy/db/authorization` account facts with CAP-owned live Room/Round
  projections or MSG-owned channel, request, block and grant projections.
  Missing authority fails closed. No realtime delivery or complete subscribe
  adoption is implied by the evaluator.
- **Fresh transaction facts.** Account mutations and channel work lock ordered
  account rows in the same PostgreSQL transaction before contact-pair and channel
  fences. Age projection remains in shared server composition; messaging receives
  only minimal current age facts. Social evidence binds resource, policy,
  relationship, account and age revisions, actor identities and expiry. The
  evaluator revalidates those current facts when consuming evidence. Unresolved
  age/contact policy supplies no affirmative production authority.
- **The `auth → protocol` edge.** Portable capability contracts live in
  `@daisy/protocol/authorization`; the allowed and declared dependencies of
  `@daisy/auth` are `errors` and `protocol`. Auth never imports persistence or
  framework code. `@daisy/db` returns projections and never imports auth.
- **Ranked is Daisy's; leagues are future tournament tenants.** Ranked Rounds
  belong to no league and count on Daisy's own ladder (one per format and
  season), and anyone with an actor may host ranked or unranked play. A
  league is an organizer's private tournament space with its own UI: it never
  owns a ladder, and none exists at launch. The epic adds no migration;
  tenancy, with row-level security in place before the first league, arrives
  with LEAGUE-OPS (ADR 0048 section 6).
- **Denied reads** answer `NOT_FOUND` for every principal; denied
  non-read capabilities answer the authentication, participant-redirect or
  authorization result; an unavailable identity answers 503 before any
  decision.

Detailed documents: persistence and Redis semantics
(`docs/architecture/persistence.md`), engine boundary
(`docs/domains/engine.md`), decision records (`docs/decisions/`).
