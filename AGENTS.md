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
- UI rules, including mutating forms that work without JavaScript: [UI conventions](docs/development/ui-conventions.md).
- Policy decisions and the policy gate: [identifier strategy](docs/decisions/0018-cuid2-identifiers.md), [token and secret ownership](docs/decisions/0019-token-secret-ownership.md), [auth activation](docs/decisions/0020-auth-activation-gates.md), [AIDD overrides](docs/decisions/0021-repository-aidd-overrides.md), and [greenfield baseline](docs/decisions/0023-greenfield-baseline.md).
- Structural change recipes: [extending the repository](docs/development/extending.md).
- The delivery process (slice → discovery and plan → one confirmation → one PR → PR loop → async reviews): [the slice process](docs/development/agent-pipeline.md) and [ADR 0083](docs/decisions/0083-lean-gates-and-slice-process.md).
- Parallel sessions, branches, and shared surfaces: [parallel work](docs/development/parallel-work.md).
- Multi-agent orchestration: [pu workflow](docs/development/pu-workflow.md).
- Reviews as async PR comments: [reviews](docs/development/reviews.md).
- Merges and the two operating modes: see "Two modes" below and [pu workflow](docs/development/pu-workflow.md).
- New slices and epics: the repository skill [epic-pipeline](.claude/skills/epic-pipeline/SKILL.md).

## The slice process

An owner instruction to implement an outcome authorizes discovery, planning,
task administration, PurePoint delegation, building, reviews and fixes within
that outcome. Do not turn routine work into repeated owner or parent
approval. A planning-only request stays planning-only. The full process is
[the slice process](docs/development/agent-pipeline.md):

1. **Semantic slice.** One Claude builder owns a slice of the product, wide
   enough that it never needs to know what other builders are doing. Its
   brief is a mission (outcome, owning intent pages and ADRs, inherited PRs
   and branches, autonomy rules), not research.
2. **Discovery and plan, intent first.** The builder does its own discovery,
   then writes one plan with a task list in `Plans/<slice>` and posts it on
   the PageSpace Delivery channel. The plan starts from intent, not from the
   existing code, in this order: Intent; Concepts and names; Ideal design
   (written before studying the current implementation); Current state and
   divergence; Refactors first; Build. The template is in
   [the task skill](.claude/skills/task/SKILL.md).
3. **One confirmation, after a dialogue.** Planning is a dialogue: the builder
   posts intent and design questions on Delivery as they arise ("is X the
   same concept as Y?", "the code does Z, the ideal is W: refactor?"), and
   the point guard answers and challenges ("is this the best way, or just the
   existing way?"). The architecture reviewer and the point guard confirm or
   redirect once the Ideal design and Divergence sections have been
   discussed. Nothing else needs approval; later product,
   architecture or scope questions go to the point guard on the Delivery channel.
4. **One PR.** The builder builds the whole slice on one branch, as one PR
   naming every task code. It splits off an earlier PR only when a piece
   must ship first.
5. **PR loop.** The builder converges the PR with its harness's PR loop, run
   verbatim until it emits `PR_READY`. Claude Code builders run PR Loop (Ralph Loop), PageSpace
   `cvslieavdwwkbz8l551hhhsz`; Codex and opencode builders run PR Loop (Goal),
   `asdc6hmpbeyu9ujlqrnes1oc`. Both live in Resources › Universal prompts.
6. **Async reviews.** `/review`, `/code-review` and the architecture
   reviewer post PR comments that the loop consumes.

The branch may carry incomplete work and red checks between pushes. Only
main receives merged PRs; commits from inherited branches are carried into
the slice branch, and no PR is merged into another branch. Production
identity, secrets, deployment and data actions retain human sign-off.

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
  consumers. A foundation whose reader is a committed leaf is the exception:
  declare it in `policy/planned-readers.json` with the task that reads it and a
  `reviewBy` date (ADR 0057), so a box may ship before its reader and still
  go red if nobody adopts it.
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
- No admin screens or admin-only routes in `apps/web`: admins get a
  separate future admin app with its own accounts and a signed internal
  API (`scripts/check-boundaries.ts` enforces this mechanically); see
  [ADR 0043](docs/decisions/0043-no-admin-surface-in-participant-app.md).

## Design constraints

These four architecture rules are blockers in every plan and review (owner,
2026-10-27):

- **Never build on flawed architecture.** When a feature's structure (names,
  modules, types, tables, pools) does not match the product's concepts,
  refactor it first, in the same slice, before adding to it. Never work
  around it. Refactoring is cheap for agents; spaghetti is not.
- **One concept, one home.** Each product feature owns its names, types,
  tables, routes, prompts and capacity. It may read another feature's
  published output only as an explicit, read-only, named input; it never
  borrows another feature's types, statuses, pools or modules.
- **No coupling for efficiency.** Saving a call, a table or a pool is never a
  reason to merge two concepts. The anti-example is ADR 0071, which made the
  AI judge's ballot feedback double as the "coaching" report.
- **Words matter.** "Coaching" and "coach" are reserved for future human
  coaches. The AI post-round report is **Round analysis**.

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
- Transitions are total before a slice PR merges. During branch work, record
  incomplete transitions and their remaining proof. Once we accept a decision to replace an approach (a pipeline,
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
- Every log field, database column, Redis key and vendor-held record has a
  privacy category (`none | identifier | personal | sensitive | secret`)
  and, when personal, a visibility (`public | private`); identifiers are
  scoped per telemetry surface (logs, errors, analytics), never global. See
  [privacy](docs/operations/privacy.md), [ADR 0036](docs/decisions/0036-privacy-by-design.md).
- A personal-data column ships with its classification (category,
  visibility, purpose, lawful basis, retention, erasure) in the PR body in
  the same change; `bun privacy` (planned, PRIV-3) will gate undeclared or
  stale entries in `data-inventory.ts` once built. See
  [privacy](docs/operations/privacy.md).
- Error tracking and product analytics go only through the `ErrorReporter`
  and `track` adapters (Sentry, PostHog); both stay inert without their
  deploy-time keys, and a raw exception goes only to the scrubbed error
  tracker, never to logs. See [ADR 0037](docs/decisions/0037-error-tracking-and-product-analytics.md).
- `necessary`, `analytics` and `replay` consent categories always exist in
  the stored schema regardless of deploy configuration; `unanswered` counts
  as denied. See [privacy](docs/operations/privacy.md).
- Schema changes use `bun db:generate`, reviewed SQL and metadata, forward
  migrations, and expand/contract for rolling deployments. Never rewrite an
  applied migration or reset production; the only sanctioned history rewrite
  is a greenfield baseline squash recorded in
  `policy/migration-baselines.json` (ADR 0023, ADR 0038), which requires resetting
  every local and test database once.

## Test contract

- Use TDD: red, green, refactor. New behavior lands with tests in the same
  change; never skip, weaken, or disable tests.
- Tests use RITEway's `riteway/bun` imports and call `setupRitewayBun()` once
  per file. Prefer `assert({ given, should, actual, expected })`; assert an
  expected `AppError` with `assertRejects` from `@daisy/errors/testing` (it
  checks the code), and use a specific `toThrow(message)` only for other
  exception paths, never a bare `.toThrow()`. The canonical example is
  `packages/debate-engine/src/engine.test.ts`.
- Inject clocks and IDs. Do not sleep-and-hope, share mutable test state, or
  point integration tests at non-test data. `TEST_DATABASE_URL` must end in
  `_test`; integration also requires `TEST_REDIS_URL`.
- `bun run knip` reports unused files, exports, and dependencies. It warns
  on PRs and blocks the nightly main run, so keep it at zero. Keep
  `knip.jsonc` ignores limited to genuine implicit uses.
- `bun run duplication` reports copy-paste (jscpd, ADR 0026): clones of 50+
  tokens not in `.jscpd-baseline.json` or `.jscpd-tests-baseline.json`. It is
  a report, not a gate. When it fires, consolidate during the review loop's
  `/simplify` pass by extracting the shared function, component, or data
  table into the owning module. Never raise `minTokens`, add an ignore, or
  re-baseline to quiet it.
- ESLint `max-lines` and `complexity` warn. Treat a warning as a prompt to
  split or simplify, not as a blocker.
- `bun evidence` reports suites no runner claims, integration guards that
  skip instead of throwing on missing services, and gates that silently stop
  running in CI. It runs, with knip, duplication and the coverage trend
  (`bun metrics:check`), in CI's non-blocking advisory reports job.
  `bun invariants` and `bun policy` are part of `bun check`.
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

Code in parallel; heavy commands queue machine-wide. The scripts `build`,
`typecheck`, `lint`, `test`, `test:integration`, `test:e2e`, `check`,
`check:affected`, `verify`, `knip`, `duplication`, `dev` and `dev:agent` run
through `scripts/heavy.ts` (use `bun run test` and `bun run build`: the
built-ins `bun test` and `bun build` bypass it), one at a time across every
checkout (`DAISY_HEAVY_CONCURRENCY`, default 1); commands they start run
inside the same slot. Every run, dev servers included, is terminated at
`DAISY_HEAVY_TIMEOUT_MINUTES` (default 45). A dev server holds the slot while
it runs: stop idle ones.

- `bun doctor`: checks Bun version, environment parsing, PostgreSQL reachability,
  migration currency, Redis reachability, and architecture boundaries. Add
  `--json` for a machine-readable report. It should pass before service-based
  work.
- `bun check`: the blocking gates, as in CI: `format:check`, lint and
  boundaries, policy, invariants, typecheck, unit tests, and production
  build. It does not boot Next or require integration services, but its
  policy stage lists open PRs for ADR and migration number claims, so it
  needs the network and an authenticated `gh` (`GH_TOKEN` in CI).
- `bun check:affected`: fast per-slice inner loop over changed files and the
  affected turbo graph. CI runs it once per PR or main push as the quick check;
  a branch push without a PR runs no CI, so open the slice PR early. The
  optional `.githooks/pre-push` hook allows branch pushes and runs the full
  gate for an exact clean candidate pushed to main.
- CI on a PR: the quick check, then `policy`, `invariants` and `build`,
  plus image, audit, migrations, and Infrastructure contracts; Chromium
  Playwright; and Isolated Room Launch unless every changed file is
  documentation or in a known non-room area. The nightly main run adds every
  Playwright project, and knip blocks there. Required checks: CI gate,
  Playwright E2E, Isolated Room Launch E2E.
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
- `bun run test`: fast deterministic tests, queued. `bun test:integration` requires
  `bun slot:up` (shared services, this checkout's migrated databases). `bun test:e2e` runs Playwright
  against the production build and uses Node 24 only as its driver runtime.

## Local workflow

1. `bun install --frozen-lockfile`
2. `cp .env.example .env`
3. `bun slot:up`
4. `bun dev` or the clean-environment `bun dev:agent`
5. `bun doctor`, then the relevant tests and verification gates

Every checkout (the main checkout and each git worktree or `pu` slot) shares
one local Postgres and Redis and owns the databases, Redis namespaces and
ports `bun slot:up` derives from its folder; never hand-edit them. Run
`bun slot:down` at handoff when no reviewer needs the data. See
[local development](docs/development/local-development.md#parallel-sessions-on-one-machine)
and [ADR 0034](docs/decisions/0034-shared-stack-slots.md).

Use `bun db:generate` for schema changes, review generated SQL, and use
`bun db:studio` only for local inspection. See [database operations](docs/operations/database.md)
for test roles, reset restrictions, and migration safety.

## Two modes: owner and autonomous

The owner works in the loop and merges any PR whenever they choose. Agents
started by `pu` run autonomously (`DAISY_AUTONOMOUS=1`) under the agent
machine identity from the main checkout's `.env.agent`, never the owner's
token or SSH key (`bun doctor` checks it). Until the owner creates that file
(GRD-6.2), agents act as the owner and `bun doctor` warns.

Builders never merge. The point guard's flow sweep merges a PR into main
once its builder has emitted `PR_READY` and the required checks are green at
the exact head, at most two merges per cycle.

- Spawn agents with `pu spawn` and message them with `pu send`. Post plans,
  questions, decisions and status to the PageSpace Delivery channel
  (`pagespace channels send ijy2klr2s7g77351a0zilrol "<slice>: <message>"`) and incidents (main red,
  staging down, security) to Incidents (`pagespace channels send
h72n2om8p0oq3y3h6nfjy1pm "..."`); the pu channel is retired. Builders report to whoever spawned
  them directly; the owner is not the message bus. Reviewers join the
  builder's worktree (`pu spawn -w <worktree>`) and are killed once they
  have posted.
- Code-writing help is a `pu` child in its own worktree, never a
  worktree-isolated subagent or fork; subagents and forks do read-only work.
- Take ADR numbers from `bun adr:next`; `bun policy` fails a
  number an earlier open PR holds.
- A decision made on the owner's behalf is recorded with
  `bun decision:record`; it stays open until confirmed or overruled.
- Board plumbing is committed: `bun board:read|status|create|relate|replace`
  and `bun board:stale`. Hand off with the `/handoff` skill.

## Work management

Codex must run the `pagespace` CLI outside its sandbox, requesting command
escalation when required. The sandbox can block network access or access to
the CLI's stored credentials; a failure inside it is not evidence that no
credential exists. Retry sandbox-blocked PageSpace commands with escalation
before diagnosing missing credentials or asking the owner to log in. Never
print credentials or copy them into the worktree to bypass the sandbox.

All repository work is planned in the PageSpace "Daisy Debate" drive
(`lguvh1y1ejhadk96xcftohha`, via the `pagespace` CLI). Its root is Table of
Contents, General Discussion (the human channel), Product, Resources, Agents
and Business:

- `Product` holds everything about building Daisy: Vision; Project Status
  (`qndsohpp7nihje7a2dw3a2kl`, every area scored on Features, Stable,
  Hardened, Scale and Spec, plus what is in flight now); `Product intent`, one
  page per area with its purpose, Score block, "What 100% means", constraints,
  tensions and future intent; `Roadmap` (epics, phases and leaves); `Issues`;
  `Plans`, `Prompts` and `Reviews`; and `Documentation`.
- `Resources` holds reusable material: `Designs` and `Universal prompts` (the
  PR loops).
- `Agents` holds the agent channels (Delivery, Standup, Epic Updates,
  Incidents) and the Documentation Agent.
- `Business` holds founder material.

Start at Product → Project Status, then the area's Product intent page.
Before planning or building, read the applicable area pages and their
"Constraints other features must respect now" sections, following
affected-capability cross-links, and link them from the slice plan. Project
Status is generated from the area pages' Score blocks by `bun progress:sync`;
change a score on its area page, never on the canvas. Design work extends the
existing shipped UI and canvases in `Resources/Designs`. Record and claim work
within the owner-authorized outcome; board administration never reauthorizes
the same outcome. Advance In Progress to In Review when the slice PR opens. A
merge moves the PR's tasks to Done when its latest review verdict approves,
otherwise to Merged ([reviews](docs/development/reviews.md)). Status belongs
in the status field; task bodies are acceptance criteria (`Given X, should
Y`).

PageSpace is the workspace, not only the board. The slice plan and its task
list live in `Plans/<slice>`, mission briefs and shared rules in `Prompts`,
and reusable prompts in `Resources/Universal prompts`. Reviews live on the
PR. Tasks mention the plan and the PR in their Related pages; documents use
page mentions, and GitHub descriptions and comments use verified PageSpace
URLs. Never upload credentials or environment secrets to PageSpace. Obsolete
pages go to the PageSpace trash, which is restorable: there is no Archive
folder and no pointer or index page that only repeats another page. Moves keep
page ids, direct task-list membership, criteria and status. Board and
scratch-versus-durable-artifact rules are in [parallel
work](docs/development/parallel-work.md#branch-and-worktree-hygiene); they
apply to every agent, worktree or not.

Work that is not an epic leaf goes in the `Product/Issues` task list, always
inside one of its buckets (Bugs, Test coverage, Agent tooling, Doc and spec
drift, User feedback, Backlog, Pending decisions), never directly under
Issues and never in GitHub Issues. `bun board:create --issue --bucket <name>`
files it, and `bun board:stale` fails on an issue left directly under
Issues. It holds defects found after the owning leaf is Done, review
findings and minors with no open leaf to carry them, and small non-epic
improvements. The test is whether an open leaf owns it: if one does, the
finding is a follow-up leaf under that phase regardless of merge state. Title `ISSUE-n — Given X, should
Y`; the body records origin (PR, review comment, reporter), why, and the
acceptance criteria; the Related pages block links the origin. An issue
closes through a PR that names it, or is promoted to an epic leaf when it
grows into feature work. `Issues/Backlog` holds feature candidates awaiting a
spec, and `Issues/Pending decisions` the open owner decisions. Filing is an obligation: whoever observes a defect or a deferrable
improvement — reviewer, builder, or orchestrator — creates the leaf or issue
in the same session rather than mentioning it in prose, because an
observation that lives only in a comment or a handoff is lost once the PR
merges. During discovery, the slice builder reads every `Issues` bucket for
anything touching its slice and carries it into the plan; a slice cannot
close while any issue it produced is untriaged (promoted, scheduled, or
deferred by the owner with a reason).

Open and update pull requests with the `/pr` skill: the description links
the plan, prompt and task pages so a reviewer can check the change against
what was asked. PR titles are conventional commits: the documentation
pipeline classifies a merge from that prefix (`!` marks a breaking change)
and reads task codes from the title, branch and body, so name every task
code in full (`AUTH-3.1`, `AUTH-3.2`, never `AUTH-3.1–3.6`). Reviews are PR
comments in the [reviews](docs/development/reviews.md) format, and the
builder's PR loop consumes them.

Parallel sessions follow [parallel work](docs/development/parallel-work.md):
one branch and one PR per slice, and execution changes update the plan
without a new approval relay; changed product intent or scope cuts go to the
point guard on the Delivery channel. The orchestrator owns Agent Memory writes.

Report meaningful milestones, final delivery, genuine blockers and actual
writer conflicts directly to the spawning parent. Use the designated PageSpace
channels for requested standups, epic milestones, merge discussion and incidents;
do not duplicate routine task administration as messages or wait for acknowledgments.
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
Keep commits scoped and never commit `.env`, `.env.agent`, secrets, generated
build output, or `.pu/` runtime state (only `.pu/config.yaml` and
`.pu/agent-context.md` are committed).
