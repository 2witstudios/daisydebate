# Engineering rules

The rules that apply to every change. Package responsibilities and allowed
edges are in the [architecture overview](overview.md).

## Architecture rules

These rules are blockers in every plan and review (owner, 2026-10-27 and
2026-11-02):

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
- **Pure, semantic structure is mandatory.** Pure model: state is one explicit
  data type where impossible combinations cannot be represented, not parallel
  variables that each hold part of the truth. Pure functions: decisions and
  transitions are pure and total, with effects described as data or run at the
  edges through injected resources. Semantic naming: names state the product
  concept, not the mechanism or the author. Semantic file organization and
  modularity: one concept per file, named for it, laid out by concept, with
  small explicit interfaces.

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
  `AGENTS.md` only when its rules differ from these.
- Before adding or configuring a dependency, read its version-matched official
  documentation. Record significant direct dependencies in
  [the dependency registry](../dependencies.md); add an ADR for consequential
  choices. For Next.js, read the installed docs under
  `apps/web/node_modules/next/dist/docs/` first.
- No Rust, Kubernetes, Kafka, event sourcing, second Redis client, speculative
  shared package, or second validation/error/state-management library in this
  foundation without an explicit architectural decision.
- No admin screens or admin-only routes in `apps/web`: admins get a
  separate future admin app with its own accounts and a signed internal
  API (`scripts/check-boundaries.ts` enforces this mechanically); see
  [ADR 0043](../decisions/0043-no-admin-surface-in-participant-app.md).

## Engineering constraints

- Security practices follow Eric Elliott's guidance: zero trust at every
  boundary, pure functions everywhere, unguessable cuid2 identifiers
  (`@paralleldrive/cuid2`) instead of UUIDs, SHA3-256 hashing for secret
  storage and comparison, and OS CSPRNG entropy (never `Math.random`)
  wherever randomness touches anything security-adjacent. The exact
  historical-accounting migration exception in [ADR 0018](../decisions/0018-cuid2-identifiers.md)
  permits predictable derived usage IDs only, never actor/runtime generation
  or authorization by identifier secrecy.
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
  incomplete transitions and their remaining proof. Once we accept a decision
  to replace an approach (a pipeline, integration, transport, or tool), replace
  it in one move: delete the old code path and its tests, config, CI steps,
  secrets, docs, and everything it created outside the repo (PageSpace
  workflows, webhooks, triggers, data rows). Never keep a fallback, dual path,
  compat special case, or "kept for now" remnant of an approach abandoned
  because it did not work, and never write docs that narrate the old way. If a
  removal must wait on a deploy, track it as a task, not a comment.
- PostgreSQL is the durable source of competitive truth. Redis is expendable
  and must use validated namespaced keys with expiry. See
  [persistence](persistence.md) and
  [database operations](../operations/database.md).
- Use UTC ISO timestamps, cuid2 application IDs (with only ADR 0018's exact
  historical-accounting exception), documented UUID exceptions,
  and integer millisecond durations. cuid2 IDs are identifiers, never bearer
  secrets. Use structured logging; never log credentials, cookies, raw request
  bodies, or raw exceptions. Public errors must not expose internals.
- Compliance is recorded per obligation and data class in
  [compliance](../operations/compliance.md), never per column. A change
  that adds a data class, purpose, processor or retention period updates
  that page in the same PR. No personal data reaches a log, error report or
  analytics event; identifiers are scoped per telemetry surface. Erasure
  keeps the competitive record, username included
  ([ADR 0087](../decisions/0087-compliance-from-obligations.md)).
- Error tracking and product analytics go only through the `ErrorReporter`
  and `track` adapters (Sentry, PostHog); both stay inert without their
  deploy-time keys, and a raw exception goes only to the scrubbed error
  tracker, never to logs. See [ADR 0037](../decisions/0037-error-tracking-and-product-analytics.md).
- `necessary`, `analytics` and `replay` consent categories always exist in
  the stored schema regardless of deploy configuration; `unanswered` counts
  as denied. See [compliance](../operations/compliance.md).
- Schema changes use `bun db:generate`, reviewed SQL and metadata, and forward
  migrations. Once Daisy has real users, they also use expand/contract for
  rolling deployments. Until then, a merge to staging needs no deploy window,
  rolling-deploy compatibility or expand/contract staging, and a destructive
  migration only needs stating in its PR (DEC-304). A migration must never be
  able to refuse and block a deploy, and production keeps human sign-off. Never
  rewrite an applied migration or reset production; the only sanctioned history
  rewrite is a greenfield baseline squash recorded in
  `policy/migration-baselines.json` (ADR 0023, ADR 0038), which requires resetting
  every local and test database once.
- Update the relevant deeper document when behavior or architecture changes.
  Keep commits scoped.
