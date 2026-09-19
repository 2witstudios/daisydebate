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
   typecheck, unit tests, production build). CI additionally runs the
   integration tier with service containers and the browser tier with
   Chromium.

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
- No test skips, `console` noise, or relaxed strictness to force green.
  Flaky tests are bugs.
- New domain behavior lands with engine tests first; new durable behavior
  lands with an integration test through the application operation, not by
  mocking the database.
- Playwright config env demonstrates the full production-refined
  configuration; keep it that way so e2e failures catch config regressions.
