# Testing

Four tiers, all runnable locally. Faster tiers must not require slower
infrastructure. All unit tests follow TDD and the RITEway format (ADR 0014);
`packages/debate-engine/src/engine.test.ts` is the canonical example. Generic
AIDD/Vitest guidance is overridden here by Bun and RITEway (ADR 0021).

## Tiers

1. **Unit/domain (`bun test`)** — every package's `src/`. Debate engine
   contract tests run the real Adobe ECS adapter; protocol, config, errors,
   logger, observability, and web HTTP-boundary tests are deterministic and
   need no services, no Next boot, no network.
2. **Integration (`bun test:integration`)** — real PostgreSQL and Redis via
   Compose, plus the web vertical: the foundation proof API exercised through
   actual route handlers (validation, principal, engine, persistence, error
   mapping). Requires `bun infra:up` and a migrated test database.
3. **Browser E2E (`bun test:e2e`)** — Playwright boots the **production**
   server (`bun run start`, `NODE_ENV=production`) with production-refined
   configuration and asserts route shells, metadata titles, security
   headers, correlation IDs, health/readiness, and 404 behavior including
   the closed foundation-proof gate. The driver runs under Node 24; config
   and specs live in `apps/web`. The production-refined configuration uses
   the `daisy_e2e` role against `daisy_test` (created by
   `infra/init-test-database.sql`); on volumes initialized before that role
   existed, create it manually (see `docs/operations/database.md`).
4. **CI parity** — `bun check` approximates the CI checks job (format, lint,
   policy, knip, invariants, evidence, typecheck, unit tests, metrics policy,
   production build). CI additionally runs the
   integration tier with service containers and the browser tier in the
   dedicated `e2e.yml` workflow (one E2E owner per PR; `bun evidence`
   fails if a second workflow also runs `test:e2e`). `bun verify` runs those additional gates locally and also applies
   the committed migrations twice to `TEST_DATABASE_URL` to prove reruns are
   idempotent.

## Suite wiring (`bun evidence`)

A suite that nothing invokes is indistinguishable from a suite that does
not exist — PageSpace lost entire tiers this way. `bun evidence` (in
`bun check` and CI) is the live audit:

- Every `*.test.ts` and `*.test.tsx` must sit in a claimed location: a
  workspace's `src/` (`bun test src`, the unit tier), root `scripts/`
  (`bun test scripts`, the root-script tier), or the root eslint config
  test (`bun lint`). Anything else is an ORPHAN_SUITE.
- Every `integration/` suite must be named by its workspace's
  `test:integration` script and must **throw** when
  `TEST_DATABASE_URL`/`TEST_REDIS_URL` is missing — a guard that skips
  instead of failing is GUARD_MISSING.
- Every `*.e2e.ts` is claimed by the Playwright config, and exactly one
  workflow runs `test:e2e`.
- `bun test src` globs only `*.test.ts(x)`, and Playwright matches only
  `*.e2e.ts` under `apps/web/e2e/`. A `*.integration.ts(x)` or
  `*.e2e.ts(x)` under `src/`, and any `*.e2e.tsx`, is recognized as a
  suite but executed by no runner, so it fails as ORPHAN_SUITE.
- The `knip`, `policy`, `invariants`, `evidence`, and `migrations:check` gates must
  appear in `ci.yml`, so deleting a job breaks CI instead of silently
  retiring a gate.
- `bun policy` scans repository-owned source for direct UUID generation and UUID
  contracts. Only exact, documented entries in `policy/exceptions.json` can
  allow framework, tooling, migration, or integration-isolation uses. Every
  exception must link an existing ADR and include a future-or-today ISO
  `reviewBy` date; missing, expired, duplicate, or nonexistent-path entries
  fail the gate.

## Rules

- **TDD.** Write the failing test first (red), make it pass (green), then
  refactor. New behavior lands with its tests in the same change. Never
  skip, disable or weaken a test to get green; a flaky test is a bug.
- **RITEway format.** Tests import `describe`, `test`, `assert` and
  `setupRitewayBun` from `riteway/bun` (9.3.0, the Bun-native entry point),
  call `setupRitewayBun()` once per file, and assert value contracts with
  `assert({ given, should, actual, expected })`. `bun:test`'s
  `expect(...).toThrow()`/`rejects.toThrow()` is allowed only on exception
  paths. `given`/`should` read as a specification sentence: when the
  assertion fails, its message is the bug report.
- **Dead code.** `bun run knip` fails on unused files, exports and
  dependencies; keep findings at zero (ADR 0013).
- Tests are deterministic: inject clocks/IDs; never sleep-and-hope; no
  cross-test shared state; use deterministic unit IDs and CSPRNG isolation IDs
  only in real-service integration tests; clean only records you created.
- Integration tests read `TEST_DATABASE_URL` (must end in `_test`) and
  `TEST_REDIS_URL`; never point them at development or production data.
  Missing services hard-fail (`throw`), never skip.
- No test skips, `console` noise, or relaxed strictness to force green.
  Flaky tests are bugs.
- New domain behavior lands with engine tests first; new durable behavior
  lands with an integration test through the application operation, not by
  mocking the database.
- Auth work follows route gate → Principal resolution → authorization → atomic
  rate limit. A limiter outage must use the operation's documented safe failure
  behavior; tests must cover the outage path before route activation.
- Playwright config env demonstrates the full production-refined
  configuration; keep it that way so e2e failures catch config regressions.

## UI component tests

UI under `apps/web/src/ui/` is Tier 1: tests sit next to the component as
`<name>.test.tsx`, render with `react-dom/server`'s `renderToString`, and
assert behavior (landmarks, accessible names, link targets, store-driven
content) rather than markup snapshots. No DOM library is installed or needed.
`bun test src` runs them, and `bun evidence` counts them in the unit tier
and orphan-checks them like any `*.test.ts` suite.

- CSS modules resolve to `undefined` under `bun test`, so never assert on
  generated class names. To lock class correctness, read the `.module.css`
  file and assert the key is defined (see `presence-dot.test.tsx`).
- Store-driven components read the module-level store: call
  `setUiState({ ...createInitialState(), … })` at the start of each test so
  no test depends on another's state.
- `next/link`, `next/image`, and `usePathname` render under plain
  `react-dom/server` (`usePathname` returns `null`).
- **The `.render.tsx` split.** When a component needs client hooks or the
  store but its markup deserves direct tests, split it: `<name>.tsx` is the
  `'use client'` shell that reads hooks and passes plain props and void
  callbacks; `<name>.render.tsx` exports a pure `render<Name>(props)`
  function with no hooks. The pure half gets the unit tests
  (`<name>.render.test.tsx`), including callbacks, which can be invoked
  straight off the returned element's props. `nav-item` and `search-input`
  are the examples. Do not split components that render fine as-is.
- **Effect extraction.** `useEffect` never runs under `react-dom/server`, so
  a component whose only work is an effect keeps a thin shell and moves the
  write into a pure function that takes its DOM target as a parameter; the
  test passes a plain recording object. `theme-effect.tsx` and
  `apply-theme.ts` are the example.

## Test file naming

New packages name their suite `src/index.test.ts`. Existing subject-named
suites (`errors.test.ts`, `protocol.test.ts`, `auth.test.ts`,
`engine.test.ts`) stay as they are; do not rename them. App and UI tests are
named after the file they specify.

## CI Artifacts

The Browser E2E workflow uploads `apps/web/test-results` and
`apps/web/playwright-report` after each non-cancelled run. On failures these
contain screenshots, videos, traces, the HTML report, and the production
server's structured `server.log`; server logs run at `info` level so request
IDs can be correlated with browser failures without rerunning CI.
