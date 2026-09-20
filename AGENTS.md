# Daisy engineering map

This file is the short operating map for the repository. It states the rules
that apply everywhere and points to the deeper source of truth. Keep behavior
and detailed procedures in the linked documents, not here.

## Start here

- Runtime and package manager: Bun 1.4.2, pinned by `.bun-version` and
  `package.json`. Use Bun only: never npm, npx, yarn, or pnpm.
- Repository shape: Bun workspaces plus Turborepo; one modular monolith.
- Delivery: `apps/web` owns Next.js routes and feature-local application
  operations.
- Domain: `packages/debate-engine` (`@daisy/debate-engine`) is framework-free.
- Contracts: `packages/protocol` owns portable, versioned JSON contracts.
- Adapters: `packages/db` owns PostgreSQL; `packages/redis` owns expendable
  Redis state. Database rows are persistence representations, not domain
  entities.
- Package responsibilities and allowed edges: [architecture overview](docs/architecture/overview.md).
- Local setup and command catalog: [local development](docs/development/local-development.md).
- Test tiers and test rules: [testing](docs/development/testing.md).
- Policy decisions and the policy gate: [identifier strategy](docs/decisions/0018-cuid2-identifiers.md), [auth activation](docs/decisions/0020-auth-activation-gates.md), and [AIDD overrides](docs/decisions/0021-repository-aidd-overrides.md).
- Structural change recipes: [extending the repository](docs/development/extending.md).
- Parallel sessions, branches, and vertical ownership: [parallel work](docs/development/parallel-work.md).
- Preferred multi-agent orchestration: [pu workflow](docs/development/pu-workflow.md).

## Dependency rules

- Dependencies point inward: delivery and feature operations may call domain,
  protocol, and adapters; domain and protocol never import React, Next,
  Drizzle, Bun SQL, Redis, HTTP, or framework session globals.
- Import workspace public APIs only. Declare every direct dependency in the
  owning package. The ESLint rules and `scripts/check-boundaries.ts` enforce
  declared dependencies, the acyclic graph, explicit exports, and Adobe ECS
  isolation.
- Put new work in its owning feature or package. Do not add broad `utils`,
  service, registry, or barrel files. Shared abstractions require two real
  consumers.
- A new package requires a responsibility, owner, explicit public exports,
  allowed dependencies, tests, and a package-map row. Add package-specific
  `AGENTS.md` only when its rules differ from this contract.
- Before adding or configuring a dependency, read its version-matched official
  documentation. Record significant direct dependencies in
  [the dependency registry](docs/dependencies.md); add an ADR for consequential
  choices. For Next.js, read the installed docs under
  `apps/web/node_modules/next/dist/docs/` first.
- No Rust, Kubernetes, Kafka, event sourcing, second Redis client, speculative
  shared package, or second validation/error/state-management library in this
  foundation without an explicit architectural decision.

## Design constraints

- Prefer pure functions. Domain, protocol, and feature logic have no ambient
  clock, environment, randomness, or I/O. Inject time, IDs, and resources at
  the edges; rejected operations leave state unchanged.
- Validate untrusted input, environment, and serialized messages at trust
  boundaries. Pass explicit principals into operations.
- PostgreSQL is the durable source of competitive truth. Redis is expendable
  and must use validated namespaced keys with expiry. See
  [persistence](docs/architecture/persistence.md) and
  [database operations](docs/operations/database.md).
- Use UTC ISO timestamps, cuid2 application IDs, documented UUID exceptions, and integer millisecond durations. Use
  structured logging; never log credentials, cookies, raw request bodies, or
  raw exceptions. Public errors must not expose internals.
- Schema changes use `bun db:generate`, reviewed SQL and metadata, forward
  migrations, and expand/contract for rolling deployments. Never rewrite an
  applied migration or reset production.

## Test contract

- Use TDD: red, green, refactor. New behavior lands with tests in the same
  change; never skip, weaken, or disable tests.
- Tests use RITEway's `riteway/bun` imports and call `setupRitewayBun()` once
  per file. Prefer `assert({ given, should, actual, expected })`; use
  `expect(...).toThrow()` or `rejects.toThrow()` only for exception paths.
  The canonical example is `packages/debate-engine/src/engine.test.ts`.
- Inject clocks and IDs. Do not sleep-and-hope, share mutable test state, or
  point integration tests at non-test data. `TEST_DATABASE_URL` must end in
  `_test`; integration also requires `TEST_REDIS_URL`.
- `bun run knip` is a required dead-code gate for unused files, exports, and
  dependencies. Keep `knip.jsonc` ignores limited to genuine implicit uses.
- `bun evidence` fails on suites no runner claims, integration guards that
  skip instead of throwing on missing services, and gates that silently
  stop running in CI. `bun invariants` and `bun evidence` are part of
  `bun check`.
- Repository overrides are explicit: Bun/RITEway replace generic Vitest guidance,
  `@daisy/errors` plus native `Error.cause` replaces `error-causes`, durable
  behavior uses real integration tests, and unit IDs are deterministic while
  integration isolation may use CSPRNG IDs. `bun policy` enforces the
  ADR-linked, time-bounded exception registry.
- This file is the only agent-facing operating map. Never fork it into a
  second top-level agent document (CLAUDE.md and friends); docs drift
  becomes contradictory instructions.

## Verification commands

Run commands from the repository root. Environment-dependent commands use the
values in `.env`; initialize with `bun install --frozen-lockfile` and
`cp .env.example .env` when needed.

- `bun doctor`: checks Bun version, environment parsing, PostgreSQL reachability,
  migration currency, Redis reachability, and architecture boundaries. Add
  `--json` for a machine-readable report. It should pass before service-based
  work.
- `bun check`: the pre-push gate: `format:check`, lint and boundaries, Knip,
  invariants, evidence, typecheck, unit tests, metrics policy, and production
  build. It does not boot Next or require integration services.
- `bun check:affected`: fast per-vertical inner loop over changed files and
  the affected turbo graph. A convenience, never a substitute for `bun check`.
- `bun migrations:check`: fails a branch that rewrites, reorders, truncates,
  or chain-breaks shared migrations relative to `origin/main`. Required
  before pushing `packages/db/migrations/` changes; migration generation is
  single-writer at a time.
- `bun verify`: runs `check`, integration tests, browser E2E, and applies
  migrations twice to `TEST_DATABASE_URL` to prove idempotency. It requires
  isolated services and a test database. Add `--json` for a report.
- `bun scenario <name>`: runs `scenarios/<name>.ts` as a deterministic domain
  lifecycle scenario; unsupported scenarios report a documented boundary.
  Scenario rejection steps also prove atomic state preservation.
- `bun invariants`: validates `spec/invariants.json` against the engine registry,
  referenced test source names, and registered negative fixtures. Add `--json`
  for a report.
- `bun test`: fast deterministic tests. `bun test:integration` requires
  `bun infra:up` and migrated test services. `bun test:e2e` runs Playwright
  against the production build and uses Node 24 only as its driver runtime.

## Local workflow

1. `bun install --frozen-lockfile`
2. `cp .env.example .env`
3. `bun infra:up`
4. `bun db:migrate`
5. `bun dev` or the clean-environment `bun dev:agent`
6. `bun doctor`, then the relevant tests and verification gates

Multiple local sessions (git worktrees, `pu` slots) each pin their own
Compose stack via `DAISY_STACK_NAME` and port knobs; see
[local development](docs/development/local-development.md#parallel-sessions-on-one-machine).

Use `bun db:generate` for schema changes, review generated SQL, and use
`bun db:studio` only for local inspection. See [database operations](docs/operations/database.md)
for test roles, reset restrictions, and migration safety.

## Work management

All repository work is planned in the PageSpace "Daisy Debate" drive
(`lguvh1y1ejhadk96xcftohha`, via the `pagespace` CLI); its `Tasks` page is the
operating system. Work only on committed tasks: claim `Ready` leaves, advance
In Progress to In Review at handoff, and mark Done only when acceptance
criteria are proven. Status belongs in the status field; task bodies are
acceptance criteria (`Given X, should Y`).

Parallel sessions follow [parallel work](docs/development/parallel-work.md):
short-lived vertical branches, one open vertical per agent, worktree agents
never write the board (the orchestrator owns task and memory writes), and a
deviation from the plan means updating the plan before declaring done.
Reviews use the [review record](docs/development/review-record.md) format.

While work is open, post the daily Yesterday / Today / Blockers standup and
send scope, ceremony, epic, or incident updates to the designated PageSpace
channels. Keep durable environment findings in Agent Memory. Deploy-rail and
production-data changes require a human-only sign-off leaf; agents never
self-approve.

## Deeper decisions

- Architecture: `docs/architecture/` and `docs/domains/`
- Development: `docs/development/`
- Operations: `docs/operations/`
- Decision records: `docs/decisions/`
- Dependency rationale and versions: `docs/dependencies.md`

Update the relevant deeper document when behavior or architecture changes.
Keep commits scoped and never commit `.env`, secrets, generated build output,
or `.pu/` runtime files.
