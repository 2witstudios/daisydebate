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
   mapping). Requires `bun slot:up`, which migrates this checkout's test
   database.
3. **Browser E2E (`bun test:e2e`)** — Playwright boots the **production**
   server (`e2e/support/server.ts` wrapping `src/server/start.ts`,
   `NODE_ENV=production`) with production-refined configuration. The
   wrapper adds only a loopback TLS edge (a per-run self-signed certificate,
   so the public origin is HTTPS and Secure session cookies work) and a
   capture of the outbound Resend call; tokens, users and sessions are made
   by the real handlers, and nothing under `src/` imports the wrapper. Specs
   for account-only pages sign up through those handlers
   (`e2e/support/accounts.ts`); the sign-in journey itself is driven through
   the real `/sign-in` UI (`e2e/journey.e2e.ts`). The suite asserts route shells, metadata titles, security
   headers, correlation IDs, health/readiness, and 404 behavior including
   the closed foundation-proof gate. The driver runs under Node 24; config
   and specs live in `apps/web`. The production-refined configuration uses
   the `daisy_e2e` role against this checkout's test database, in its own
   Redis database and namespace: `E2E_DATABASE_URL`, `E2E_REDIS_URL` and
   `E2E_REDIS_NAMESPACE`, which `bun slot:up` writes (CI sets them in
   `e2e.yml`). A missing value makes the server refuse to start rather than
   fall back to another checkout's data.
4. **CI parity** — `bun check` approximates the CI checks job (format, lint,
   policy, knip, duplication, invariants, evidence, typecheck, unit tests, metrics policy,
   production build). CI additionally runs the
   integration tier with service containers and the browser tier in the
   dedicated `e2e.yml` workflow (one E2E owner per PR; `bun evidence`
   fails if a second workflow also runs `test:e2e`). `bun verify` runs those additional gates locally and also applies
   the committed migrations twice to `TEST_DATABASE_URL` to prove reruns are
   idempotent.

### Release qualification (`bun test:e2e:qualify`)

The single-run `test:e2e` in the PR/push workflow proves the suite passes
once; it is not release proof by itself. Before opening a release PR (or as a
manual/scheduled job, never as an additional required PR check — that would
triple E2E wall-clock time on every push), run `bun test:e2e:qualify`. It
runs the complete Playwright suite three consecutive times with retries
disabled (the standing config), saves each run's JSON report under
`apps/web/qualification-results/run-{1,2,3}.json` plus a `summary.json` —
deliberately outside `apps/web/test-results`, which Playwright clears at
the start of every invocation and would otherwise erase each prior run's
report before the next one starts — and fails if any of the three runs has
a failure or an empty test selection.
A retry-pass or a single green run is not this gate; all three outcomes are
retained as artifacts.

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
- The `knip`, `policy`, `duplication`, `invariants`, `evidence`, and `migrations:check` gates must
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
- **Duplication.** `bun run duplication` fails on any copy-pasted block not
  in `.jscpd-baseline.json`; consolidate instead of re-baselining (ADR 0026).
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
- Mounted-route auth suites (`apps/web/integration/auth-*.integration.ts`) drive
  the real `/api/auth/[...all]`, `/auth/confirm` and `/api/webhooks/resend`
  route modules against real PostgreSQL and Redis. Only the outbound mail
  transport is replaced (a process-wide private mailbox that captures the
  production Resend sender's HTTP call); tokens, users, sessions, limits and
  cookies are all real. They share one `bun test` process, so each suite
  rebuilds the process resources in `beforeAll`. Concurrency claims use real
  simultaneous requests, and every safeguard has a sabotage control recorded in
  the PR (remove it → the named test fails).
- Auth work follows route gate → Principal resolution → authorization → atomic
  rate limit. A limiter outage must use the operation's documented safe failure
  behavior; tests must cover the outage path before route activation.
- Playwright config env demonstrates the full production-refined
  configuration; keep it that way so e2e failures catch config regressions.

### Cross-browser and accessibility coverage (AUTH-6.6)

`chromium` runs the whole functional suite (dashboard chrome, theme, CSP,
foundation proof, auth) and stays the primary CI project. Cross-browser and
mobile-layout parity is scoped to the auth journeys the spec requires
("the supported magic-link/account journeys"), not the whole app:
`chromium-mobile`, `firefox`, `webkit` and `webkit-mobile` testMatch only
`AUTH_JOURNEY_SPECS` (journey, passkey-lifecycle, accessibility, auth-routes)
in `apps/web/playwright.config.ts`. CDP WebAuthn (the virtual authenticator
behind every passkey ceremony) is Chromium-only, so
`passkey-lifecycle.e2e.ts` is additionally excluded from every non-Chromium
project; a spec that needs a Chromium-only WebAuthn capability belongs in
that file, not in `journey.e2e.ts`. The sign-in page arms passkey autofill
(conditional mediation). Under `chromium-mobile` the virtual authenticator
answers that request with no pick, so button specs either call
`withoutPasskeyAutofill` or hold user presence (`setPresence(false)` in
`e2e/support/webauthn.ts`) while autofill is armed; desktop Chromium waits
for an autofill selection the driver cannot make. That same behaviour makes
`passkey-autofill.e2e.ts` the autofill proof, so only `chromium-mobile`
runs it.
`apps/web/e2e/accessibility.e2e.ts` runs
`@axe-core/playwright` against every auth screen (sign-in idle/pending,
onboarding, settings/security, an expired link), asserting zero
serious/critical findings, plus keyboard-only navigation, a live-region
assertion and a 200%-effective-zoom reflow check (halving the viewport, the
standard technique since Playwright has no native browser-zoom control).
Real-device rows (Safari/iOS, Chrome/Android, a roaming security key) are
owner-recorded pre-release evidence, never emulated; see the review record
for the exact NOT RUN rows and what to capture.

## Styling safeguards and visual parity

Styling is token-locked Tailwind v4 (ADR 0028). Every rule fails
`bun check`, and each has a negative fixture proving it fires:

- **Lint** (`eslint-plugin-better-tailwindcss`, fixtures in
  `eslint.config.test.ts`): arbitrary values and properties (`[` in a
  class), unknown or default-theme classes, conflicting classes, duplicate
  classes, `dark:` and `scheme-*` variants.
- **Format**: `prettier-plugin-tailwindcss` sorts classes, so
  `bun format:check` fails on an unsorted class list.
- **Repository gate** (`scripts/check-styling.ts`): no `*.module.css` and no
  `tailwind.config.*` file anywhere.
- **Policy** (`bun policy`): no inline `style` attribute or `<style>`
  element in TSX and no silenced Tailwind lint rule, unless a registry
  exception links an ADR.
- **Theme** (`apps/web/src/app/theme.test.ts`): compiles the real
  `globals.css` and proves default utilities generate no CSS while token
  utilities resolve through the custom properties.

### Visual parity

`apps/web/e2e/visual.e2e.ts` takes full-page screenshots of the dashboard
and settings in dark and light at 1440, 1024 and 390 px wide and compares
them with `apps/web/e2e/visual-baselines/`. Baselines are Linux-only: fonts
render differently elsewhere. CI runs on Linux natively. On any other host
the `visual` Playwright project is excluded until a Linux browser is
provided:

```sh
bun visual:server                     # Linux Playwright image, port 43400
PW_WS_ENDPOINT=ws://127.0.0.1:43400/ bun test:e2e
```

To regenerate after an intended visual change, run the same command with
`--update-snapshots` appended to the Playwright invocation
(`node node_modules/@playwright/test/cli.js test --project=visual
--update-snapshots` from `apps/web`, with `PW_WS_ENDPOINT` set), review the
image diff, and record the before/after on the plan. The image tag in
`package.json` must match the installed `@playwright/test` version.

## UI component tests

UI under `apps/web/src/ui/` is Tier 1: tests sit next to the component as
`<name>.test.tsx`, render with `react-dom/server`'s `renderToString`, and
assert behavior (landmarks, accessible names, link targets, store-driven
content) rather than markup snapshots. No DOM library is installed or needed.
`bun test src` runs them, and `bun evidence` counts them in the unit tier
and orphan-checks them like any `*.test.ts` suite.

- Styling is Tailwind utilities written in the markup (ADR 0028), so
  `renderToString` output contains the literal classes. Variant props (button
  variant, badge tone, avatar size, tile tint, presence) are pure functions
  from props to a class string in `<name>-class.ts`; test them with RITEway
  by asserting the literal classes for every variant. Do not assert on
  stylesheet text.
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
  test passes a plain recording object. When the side effects need an
  order, put them in a controller that takes them as injected functions.
  `ui/theme/apply-theme.ts` and `ui/theme/theme-controller.ts` (used by
  `theme-provider.tsx`) are the example.

## Test file naming

New packages name their suite `src/index.test.ts`. Existing subject-named
suites (`errors.test.ts`, `protocol.test.ts`, `auth.test.ts`,
`engine.test.ts`) stay as they are; do not rename them. App and UI tests are
named after the file they specify.

## CI Artifacts

The Browser E2E workflow uploads `apps/web/test-results` and
`apps/web/playwright-report` after each non-cancelled run. On failures these
contain screenshots, videos, traces, the HTML report, and the production
server's structured `server-<port>.log` (one per app port); server logs run at `info` level so request
IDs can be correlated with browser failures without rerunning CI.
