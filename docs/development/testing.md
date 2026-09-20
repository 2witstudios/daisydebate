# Testing

Four tiers, all runnable locally. Faster tiers must not require slower
infrastructure. All unit tests follow TDD and the RITEway format (ADR 0014);
`packages/debate-engine/src/engine.test.ts` is the canonical example.

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
   knip, invariants, evidence, typecheck, unit tests, metrics policy,
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

- Every `*.test.ts` must sit in a claimed location: a package's `src/`
  (`bun test src`), root `scripts/` (`bun test scripts`), or the root
  eslint config test (`bun lint`). Anything else is an ORPHAN_SUITE.
- Every `integration/` suite must be named by its workspace's
  `test:integration` script and must **throw** when
  `TEST_DATABASE_URL`/`TEST_REDIS_URL` is missing — a guard that skips
  instead of failing is GUARD_MISSING.
- Every `*.e2e.ts` is claimed by the Playwright config, and exactly one
  workflow runs `test:e2e`.
- The `knip`, `invariants`, `evidence`, and `migrations:check` gates must
  appear in `ci.yml`, so deleting a job breaks CI instead of silently
  retiring a gate.

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
  cross-test shared state; unique UUIDs/namespaces; clean only records you
  created.
- Integration tests read `TEST_DATABASE_URL` (must end in `_test`) and
  `TEST_REDIS_URL`; never point them at development or production data.
  Missing services hard-fail (`throw`), never skip.
- No test skips, `console` noise, or relaxed strictness to force green.
  Flaky tests are bugs.
- New domain behavior lands with engine tests first; new durable behavior
  lands with an integration test through the application operation, not by
  mocking the database.
- Playwright config env demonstrates the full production-refined
  configuration; keep it that way so e2e failures catch config regressions.

## CI Artifacts

The Browser E2E workflow uploads `apps/web/test-results` and
`apps/web/playwright-report` after each non-cancelled run. On failures these
contain screenshots, videos, traces, the HTML report, and the production
server's structured `server.log`; server logs run at `info` level so request
IDs can be correlated with browser failures without rerunning CI.
