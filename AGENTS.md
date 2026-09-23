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
- Policy decisions and the policy gate: [identifier strategy](docs/decisions/0018-cuid2-identifiers.md), [token and secret ownership](docs/decisions/0019-token-secret-ownership.md), [auth activation](docs/decisions/0020-auth-activation-gates.md), [AIDD overrides](docs/decisions/0021-repository-aidd-overrides.md), and [greenfield baseline](docs/decisions/0023-greenfield-baseline.md).
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

- Security practices follow Eric Elliott's guidance: zero trust at every
  boundary, pure functions everywhere, unguessable cuid2 identifiers
  (`@paralleldrive/cuid2`) instead of UUIDs, SHA3-256 hashing for secret
  storage and comparison, and OS CSPRNG entropy (never `Math.random`)
  wherever randomness touches anything security-adjacent.
- Prefer pure functions. Domain, protocol, and feature logic have no ambient
  clock, environment, randomness, or I/O. Inject time, IDs, and resources at
  the edges; rejected operations leave state unchanged.
- Validate untrusted input, environment, and serialized messages at trust
  boundaries. Pass explicit principals into operations.
- Greenfield over backward compatibility: Daisy is pre-ship and has no
  deployed consumers, so no compat surface may outlive the mistake that
  required it. When a foundational choice proves wrong before first ship,
  remove it outright — rewrite the baseline, delete the compatibility code,
  tests, and policy exceptions, and supersede the documenting ADR. Never
  accrete legacy modes, dual-shape validators, or migration replay fixtures
  for behavior nobody depends on (ADR 0023).
- Transitions are total. Once we decide to replace an approach (a pipeline,
  integration, transport, or tool), replace it in one move: delete the old
  code path and its tests, config, CI steps, secrets, docs, and everything it
  created outside the repo (PageSpace workflows, webhooks, triggers, data
  rows). Never keep a fallback, dual path, compat special case, or "kept for
  now" remnant of an approach abandoned because it did not work, and never
  write docs that narrate the old way. If a removal must wait on a deploy,
  track it as a task, not a comment.
- PostgreSQL is the durable source of competitive truth. Redis is expendable
  and must use validated namespaced keys with expiry. See
  [persistence](docs/architecture/persistence.md) and
  [database operations](docs/operations/database.md).
- Use UTC ISO timestamps, cuid2 application IDs, documented UUID exceptions, and integer millisecond durations. cuid2 IDs are identifiers, never bearer secrets. Use
  structured logging; never log credentials, cookies, raw request bodies, or
  raw exceptions. Public errors must not expose internals.
- Schema changes use `bun db:generate`, reviewed SQL and metadata, forward
  migrations, and expand/contract for rolling deployments. Never rewrite an
  applied migration or reset production; the only sanctioned history rewrite
  is a greenfield baseline squash recorded in
  `policy/migration-baselines.json` (ADR 0023), which requires resetting
  every local and test database once.

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
- `bun run duplication` is a required copy-paste gate (jscpd, ADR 0026): any
  clone of 50+ tokens that is not in `.jscpd-baseline.json` fails. When it
  fires, consolidate — extract the shared function, component, or data table
  into the owning module — rather than raising `minTokens`, adding an ignore,
  or re-baselining. Loosening the gate in any of those ways requires a dated
  note in ADR 0026; the baseline otherwise only shrinks.
- `bun evidence` fails on suites no runner claims, integration guards that
  skip instead of throwing on missing services, and gates that silently
  stop running in CI. `bun run duplication`, `bun invariants`, and
  `bun evidence` are part of `bun check`.
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
- `bun check`: the pre-push gate: `format:check`, lint and boundaries, policy,
  Knip, duplication, invariants, evidence, typecheck, unit tests, metrics policy, and
  production build. It does not boot Next or require integration services.
- `bun check:affected`: fast per-vertical inner loop over changed files and
  the affected turbo graph. A convenience, never a substitute for `bun check`.
  The committed `.githooks/pre-push` hook runs it on every push once a clone
  opts in with `bun hooks:install`; CI enforces the full gate.
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

PageSpace is the workspace, not only the board. Plans, prompts, handoffs and
review records are task artifacts: they live in the drive's `Plans`,
`Prompts` and `Reviews` folders (one subfolder per epic), reusable prompts
and skills live in `Library`, and tasks link them with page mentions. The
rules are the drive's "Task artifacts and linking" page
(`szsrb6lui57zjemvl25ywfox`); read it before producing any of these.
Your agent's built-in todo lists, plan mode files, memory stores, local
`plan.md`/`TODO.md` files and `/tmp` are scratch only, whichever agent you
are (Claude Code, Codex, OpenCode): anything another session or a reviewer
needs must be a PageSpace page. Every agent, worktree or not, publishes its
own artifact pages and keeps its tasks current through the `pagespace` CLI
(create tasks, update status, record evidence). No agent edits the criteria
or scope of a task delegated to it: a change goes back to whoever delegated
it. Done is granted from an independent review record, never by the agent
that did the work.

Work that is not an epic leaf goes in the drive-root `Issues` task list,
never in GitHub Issues: defects found after the owning leaf is Done, review
findings and minors with no open leaf to carry them, and small non-epic
improvements. The test is whether an open leaf owns it: if one does, the
finding is a follow-up leaf under that phase regardless of merge state. Title `ISSUE-n — Given X, should
Y`; the body records origin (PR, review record, reporter), why, and the
acceptance criteria; the Related pages block links the origin. An issue
closes through a PR that names it, or is promoted to an epic leaf when it
grows into feature work. `Backlog` stays for feature candidates awaiting a
spec.

Open and update pull requests with the `/pr` skill: the description links
the task, plan and prompt pages (and handoff and reviews as they land) so a
reviewer can check the change against what was asked, and every review
verdict is also posted as a PR comment. PR titles are conventional commits:
the documentation pipeline classifies a merge from that prefix (`!` marks a
breaking change) and reads task codes from the title, branch and body, so
name every task code in full (`AUTH-3.1`, `AUTH-3.2`, never `AUTH-3.1–3.6`).
Use `/aidd-triage` for review-comment triage.

Parallel sessions follow [parallel work](docs/development/parallel-work.md):
short-lived vertical branches, one open vertical per agent, and a deviation
from the plan means updating the plan before declaring done. The
orchestrator owns Agent Memory writes.
Reviews use the [review record](docs/development/review-record.md) format.

While work is open, post the daily Yesterday / Today / Blockers standup and
send scope, ceremony, epic, or incident updates to the designated PageSpace
channels: standup for daily standups, epic-updates for epic milestones,
sprint-room for merge notices and discussion, incidents for failures.
Keep durable environment findings in Agent Memory. Deploy-rail and
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
