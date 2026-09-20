# Extending the repository

Recipes for the four most common structural changes. Structural changes need
a docs update in the same PR.

## Policy-first developer flow

1. Read ADRs 0018-0021 before adding identifiers, auth, secrets, or durable
   behavior.
2. Write the RITEway unit test first with injected deterministic IDs and clocks.
3. Add a real guarded integration test for durable PostgreSQL/Redis behavior;
   use a CSPRNG isolation ID only at that service boundary.
4. If compatibility requires UUID or direct randomness, add a narrow entry to
   `policy/exceptions.json` with path, rule, owner, reason, and category, then
   run `bun policy`.
5. Run `bun check`; do not implement the cuid2 schema migration or activate an
   auth route as part of policy-only work.

For parallel or isolated work, follow the preferred [`pu` workflow](pu-workflow.md).
Direct single-agent work may proceed without `pu`.

## Adding a package

1. Justify it: a package exists for a responsibility with an owner — never
   for symmetry with the prompt that created the repo. Shared code needs two
   real consumers first.
2. Create `packages/<name>/` with `package.json` (exact versions, explicit
   `exports` mapping only public entry points), `tsconfig.json` extending
   `@daisy/typescript-config/base.json`, `src/index.ts`, and tests.
3. Declare exactly the dependencies you import; allowed workspace edges are
   listed in `scripts/check-boundaries.ts` — extend the allowlist only when
   the edge is architecturally justified.
4. Add a row to the package map in `docs/architecture/overview.md`; add an
   `AGENTS.md` only if package rules differ from the root contract.
5. Verify: `bun lint` (boundaries), `bun typecheck`, `bun test`.

## Adding a route

1. Routes belong to a feature. If one exists (`apps/web/src/features/`),
   put application operations there; otherwise create the feature folder —
   not a global `lib/` or `components/`.
2. Page: colocate `page.tsx` under `src/app/<route>/`; export `metadata`;
   use the App Router boundaries (`loading.tsx`, `error.tsx`,
   `not-found.tsx`) rather than bespoke spinners.
3. API route: thin handler in `src/app/api/…` — resolve principal, call the
   feature operation through `handleOperation` (correlation, structured
   logging, error mapping), validate untrusted input with
   `parseValidated`/`readJson`, keep same-origin checks on mutations.
4. Route handlers must not contain domain rules; the engine owns invariants.
5. Extend `apps/web/e2e` if the route adds user-visible contracts.

## Adding a domain capability

1. Extend `@daisy/protocol` first if state crosses a boundary: schema,
   versioned snapshot/command/event shapes, tests.
2. Implement invariants in `packages/debate-engine` as pure operations on
   the runtime; no I/O, no ambient time; failing preconditions must leave
   state unchanged. Engine tests prove the invariant and the atomicity.
3. Durable effects go through an application operation:
   load authoritative snapshot → engine operation → persist with optimistic
   version → map infrastructure failures to stable public errors.
4. Update `docs/domains/engine.md` when lifecycle or invariants change.

## Adding a product vertical

A vertical is a self-contained feature slice several agents can build in
parallel. See `docs/development/parallel-work.md` for the coordination
rules.

1. Create the application operations in
   `apps/web/src/features/<vertical>/` (validation, principals,
   orchestration) — never a global `lib/`.
2. Create a route group `apps/web/src/app/(<vertical>)/` for pages and
   `src/app/api/<vertical>/` for handlers. Route groups isolate URL
   structure without touching other verticals' paths.
3. Shared app-router files (`src/app/layout.tsx`, `globals.css`) are
   coordination points: changing them belongs to a dedicated change that
   vertical PRs rebase onto, not to a vertical PR.
4. Add engine/protocol capability through the existing recipes first;
   a vertical composes the domain, it does not fork it.
5. Extend `apps/web/e2e` with the vertical's user-visible contracts.
6. Update the "Where work belongs" table in `README.md` and this file in
   the same PR.

## Adding a protocol message

1. Add the message to the discriminated union (command or event) or snapshot
   schema in `packages/protocol` with the current `version` literal.
2. Follow the evolution rules in ADR 0009: additive within a version, new
   version literal for breaking change, never repurpose fields.
3. Add round-trip validation tests (parse → serialize → parse).
4. Announce in the PR description: protocol changes are cross-team contracts
   and need coordinated rollout with realtime/worker consumers.
