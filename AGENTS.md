# Daisy engineering contract

**Don't code from model memory when versioned or official documentation is available.** Read current official docs before adding or configuring dependencies; check compatibility with our pinned versions, and update `docs/dependencies.md` and an ADR for consequential choices.

For Next.js work, read the version-matched docs shipped with our installed package at `apps/web/node_modules/next/dist/docs/` (or the resolved equivalent) first, and follow its AI-agent guide. If dependencies are absent, run `bun install --frozen-lockfile` first.

## Architecture

Bun workspaces + Turbo; modular monolith. `apps/web` owns delivery and feature-local application operations. Domain lives in `@daisy/debate-engine`; the Adobe Data ECS dependency stays private there. `protocol` owns portable versioned JSON contracts. `db` and `redis` are inward-facing adapters; rows are not domain entities. React and Next never enter domain/protocol. Import workspace public APIs only; declare direct dependencies. ESLint and `scripts/check-boundaries.ts` enforce boundaries and cycles.

Keep new work in an owning feature/package. Do not add broad utils, services, registry, or barrel files. New packages need responsibility, public exports, allowed dependencies, owner role, tests and a package-map entry. Add shared abstractions only for actual consumers. No Rust, Kubernetes, Kafka, or event sourcing in this foundation.

## Code standards

This is a Bun repo: never use npm, npx, yarn or pnpm — only `bun`, `bun add`, `bun run` and `bunx` (with `--bun` for installed tool CLIs, e.g. `bunx --bun knip`).

**Pure functions by default.** Same inputs, same outputs: no ambient reads (clock, environment, randomness) and no I/O inside domain, protocol and feature logic. Effects live at the edges — route handlers and adapters — with time, IDs and resources injected. Rejected operations must leave state unchanged.

**TDD.** Write the failing test first (red), make it pass (green), then refactor. New behavior lands with its tests in the same change. Never skip, disable or weaken a test to get green; a flaky test is a bug.

**RITEway tests.** Tests run on `bun test` and import `describe`, `test`, `assert` and `setupRitewayBun` from `riteway/bun`. Call `setupRitewayBun()` once per test file and assert with `assert({ given, should, actual, expected })`; use `expect(...).toThrow()/rejects.toThrow()` only for exception paths. `given`/`should` read as a specification sentence — the failing assertion is the bug report. `packages/debate-engine/src/engine.test.ts` is the canonical example.

**Knip gate.** `bun run knip` (in `bun check` and CI) fails on unused files, exports and dependencies. Fix findings by deleting dead code or declaring real usage; keep `knip.jsonc` ignores limited to genuine implicit references (e.g. `transpilePackages`), with the reason documented there.

## Work management

All repo work is planned and tracked in the PageSpace "Daisy Debate" drive (`lguvh1y1ejhadk96xcftohha`, via the `pagespace` CLI); its `Tasks` page is the operating system — follow it. Canonical copies of these standards live there, but this file remains the locally binding version.

Work only on committed tasks: claim `Ready` leaves, advance In Progress → In Review at handoff, and mark Done only when acceptance criteria are proven. Titles put an em-dash between label and description; leaf bodies are acceptance criteria ("Given X, should Y"); status lives only in the status field. Post a daily standup (Yesterday / Today / Blockers) to `Standup` while work is open; send scope and ceremony updates to `Sprint Room`, epic transitions to `Epic Updates`, and environmental failures or blockers older than 24h honestly to `Incidents` with the task ID (CI posts its own failures and merges to these channels automatically — don't duplicate). Keep durable environment findings in your Agent Memory doc. Deploy-rail and production-data changes always keep a human-only sign-off leaf; agents never self-approve.

## Workflow

Use Bun 1.4.2 exclusively for packages/runtime/scripts. Node 24 is only the upstream-supported Playwright driver runtime. `bun install`; `cp .env.example .env`; `bun infra:up`; `bun db:migrate`; `bun dev`.

Before completion: `bun check`; `bun test:integration` against isolated services; `bun test:e2e` for route/browser changes. `bun test` runs fast deterministic Bun tests; no Next boot for domain tests. `bun check` covers formatting, lint, typecheck, unit tests and production build. CI separately requires integration and browser tests. Never hide failures by relaxing strictness or skipping tests.

## Data and safety

Validate untrusted inputs, environment and serialized messages. Pass explicit principals into operations; no framework session globals in domain. Use structured logger fields, never credentials, cookies, raw request bodies or raw exceptions. Stable public errors must not reveal internals. UTC ISO timestamps, UUID IDs, integer millisecond durations; inject domain time/IDs.

PostgreSQL owns durable competitive records; Redis is expendable. Generate migrations with `bun db:generate`, review SQL, commit SQL and metadata, verify on an empty database. Never rewrite applied migrations; expand/contract for rolling deployments. Never run reset against production. Mutations must address transactions, authorization, idempotency and concurrency deliberately.

Review `docs/architecture/overview.md`, ownership map, relevant ADRs and domain docs before structural changes. Update docs with behavior changes. Keep commits scoped; never commit secrets, generated build outputs or `.pu` runtime files. Work independently within assigned files and coordinate before changing another owner's public API.
