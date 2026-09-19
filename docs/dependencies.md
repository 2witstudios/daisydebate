# Dependency registry

Every significant direct dependency records why it exists, where it may be
imported, its authoritative documentation, and compatibility/removal notes.
Transitive packages are not registered. Add an entry (and an ADR when the
choice is consequential) before adding a major dependency. Versions are exact;
`bun.lock` pins transitive versions. Registry versions verified 2026-09-19.

## Runtime and toolchain

| Tool           | Version  | Purpose and allowed use                                                        | Official documentation                                                                                        | Notes                                                                                                                                            |
| -------------- | -------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bun            | `1.4.2`  | Only runtime, package manager, script runner, and unit/integration test runner | [Docs](https://bun.sh/docs), [install](https://bun.sh/docs/installation)                                      | Pinned via `.bun-version`, `engines`, `packageManager`. Never use npm/pnpm/yarn. Commit `bun.lock`.                                              |
| Turborepo      | `2.11.2` | Task graph, caching, parallel orchestration; never a package manager           | [Docs](https://turborepo.dev/docs), [reference](https://turborepo.dev/docs/reference)                         | `bun --env-file=.env run turbo …` is the supported local invocation for env-dependent tasks; turbo runs in strict env mode.                      |
| TypeScript     | `6.0.3`  | Strict typing everywhere; shared config in `@daisy/typescript-config`          | [TSConfig reference](https://www.typescriptlang.org/tsconfig/)                                                | TS 7 is outside typescript-eslint's supported range; revisit after toolchain support.                                                            |
| Prettier       | `3.9.8`  | Deterministic formatting; CI checks without rewriting files                    | [Install](https://prettier.io/docs/install.html)                                                              | Exact version for stable output across machines.                                                                                                 |
| ESLint         | `9.39.5` | Correctness and architecture rules only; no stylistic rules                    | [Getting started](https://eslint.org/docs/latest/use/getting-started)                                         | `typescript-eslint` 8.70.0; `eslint-config-next` scoped to `apps/web`. Boundary rules in `eslint.config.mjs` plus `scripts/check-boundaries.ts`. |
| Knip           | `6.37.0` | Dead-code gate: unused files, exports, dependencies; root `bun run knip`       | [Docs](https://knip.dev), [workspaces](https://knip.dev/features/monorepos-and-workspaces)                    | Runs under Bun (`bunx --bun knip`); config in `knip.jsonc`. Fails CI via the `checks` matrix (ADR 0013).                                         |
| RITEway        | `9.3.0`  | `riteway/bun` assert API on `bun:test`; declared per testing workspace         | [Repository](https://github.com/ericelliott/riteway), [bun entry](https://github.com/ericelliott/riteway#bun) | Only the `riteway/bun` subpath is supported here. `expect().toThrow()` for exception paths only (ADR 0014).                                      |
| Docker Compose | current  | Local PostgreSQL/Redis only; app processes never run in Compose                | [File reference](https://docs.docker.com/compose/compose-file/)                                               | Loopback-only ports; Postgres host port is 15432 to avoid common host installs.                                                                  |
| GitHub Actions | current  | CI: frozen install, checks, integration with real services, browser e2e        | [Docs](https://docs.github.com/en/actions/get-started)                                                        | Pinned major action versions; Dependabot proposes upgrades.                                                                                      |

## Application

| Dependency            | Version  | Purpose and allowed boundary                                | Official documentation                                    | Notes                                                                                                                                     |
| --------------------- | -------- | ----------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `next`                | `16.3.5` | Application delivery layer in `apps/web` only               | [Docs](https://nextjs.org/docs)                           | Version-matched docs ship in `apps/web/node_modules/next/dist/docs/`; read before Next work. `proxy.ts` (not `middleware.ts`) is current. |
| `react` / `react-dom` | `19.3.0` | UI rendering in `apps/web` only                             | [Learn](https://react.dev/learn)                          | Never imported by domain, protocol, or infrastructure packages.                                                                           |
| `zod`                 | `4.6.5`  | Runtime validation at trust boundaries: env, protocol, HTTP | [Docs](https://zod.dev), [basics](https://zod.dev/basics) | Zod 4 top-level APIs (`z.uuid()`, `z.iso.datetime()`, `strictObject`). Parse once at boundaries; do not re-validate internal calls.       |
| `@playwright/test`    | `1.63.0` | Browser E2E in `apps/web/e2e` only                          | [Intro](https://playwright.dev/docs/intro)                | Runs under Node 24 LTS (upstream-supported driver runtime). Bun stays the only package/application runtime.                               |

## Domain and infrastructure

| Dependency           | Version   | Purpose and allowed boundary                          | Official documentation                                                                                                     | Notes                                                                                                                  |
| -------------------- | --------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `@adobe/data`        | `0.10.19` | ECS storage inside the debate-engine adapter only     | [Repository](https://github.com/adobe/data), [API](https://adobe.github.io/data/)                                          | Pre-1.0: pin exact, inspect breaking changes every upgrade (ADR 0006). Vendor types never cross the engine boundary.   |
| `drizzle-orm`        | `0.45.2`  | Typed SQL and migrations in `@daisy/db` only          | [Bun SQL](https://orm.drizzle.team/docs/connect-bun-sql), [migrations](https://orm.drizzle.team/docs/drizzle-kit-generate) | Current website snippets advertise an RC; deliberately stay on stable 0.45.2. Rows are persistence, not domain.        |
| `drizzle-kit`        | `0.31.10` | Schema diffing and studio, db development only        | [generate](https://orm.drizzle.team/docs/drizzle-kit-generate)                                                             | Generated SQL + metadata are committed and reviewed.                                                                   |
| Bun SQL (`bun:sql`)  | runtime   | PostgreSQL driver, `@daisy/db` only                   | [SQL](https://bun.sh/docs/runtime/sql)                                                                                     | Native driver requires Bun in production. Node-only/serverless hosting needs a new adapter and ADR (ADR 0012).         |
| Bun `RedisClient`    | runtime   | Ephemeral keys, `@daisy/redis` only                   | [Redis](https://bun.sh/docs/runtime/redis)                                                                                 | Redis >= 7.2. No Sentinel/Cluster; pub/sub experimental and unused. No second client without an ADR.                   |
| `pino`               | `10.3.1`  | Structured logging behind `@daisy/logger`             | [API](https://github.com/pinojs/pino/blob/main/docs/api.md), [redaction](https://getpino.io/#/docs/redaction)              | JSON to stdout; redaction is defense in depth, never an excuse to log secrets. No worker transports.                   |
| `@opentelemetry/api` | `1.9.1`   | Provider-neutral spans in `@daisy/observability` only | [JS instrumentation](https://opentelemetry.io/docs/languages/js/instrumentation/)                                          | API only; host/deployment installs provider and exporters. No SDK in the repo.                                         |
| PostgreSQL           | `18`      | Durable authoritative state                           | [Manual](https://www.postgresql.org/docs/18/)                                                                              | Container volume root is `/var/lib/postgresql`. Major upgrades need backup/restore or pg_upgrade.                      |
| Redis                | `8`       | Ephemeral coordination only                           | [Docs](https://redis.io/docs/latest/)                                                                                      | Intentionally no durable volume; loss must be harmless. Never authoritative for results, ballots, ratings, identities. |

## Deliberately absent

- No second Redis client, no ORM besides Drizzle, no date library (`Date` +
  ISO strings with injected clocks), no validation library besides Zod, no
  error library (platform `Error.cause` plus `@daisy/errors`), no state
  manager, no CSS framework yet, no OpenTelemetry SDK/exporters in-process.
- Add shared packages (`ui`, `testing`, `validation`) only when a second real
  consumer exists; do not create them speculatively.
