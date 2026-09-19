# Contributing

Start with [AGENTS.md](AGENTS.md), [README.md](README.md), and the relevant package's public API. Read current official dependency documentation before configuring or using framework APIs. Next.js work requires the version-matched documentation shipped with `next`.

Use the pinned Bun version and `bun install --frozen-lockfile`. See `.env.example` for local configuration. Run `bun infra:up`, `bun db:migrate`, and `bun dev` after copying the example environment. Never point integration tests or reset tools at production data.

Keep changes within an owned feature or package. Coordinate ownership before parallel work; prefer separate files and branches over editing shared registries. Applications compose domain APIs and infrastructure adapters. Domain code does not import Next.js, React, databases, Redis, or HTTP. Consumers import package public exports, never internal paths. Add new dependencies only with a documented need, verified official APIs, and an entry in `docs/dependencies.md`.

Run `bun check` before review — it includes the Knip dead-code gate (`bun run knip` fails on unused files, exports and dependencies). Tests follow TDD and the RITEway format (`riteway/bun`; see ADR 0014). Changes touching persistence or Redis also require `bun test:integration` against disposable services. Browser changes require `bun test:e2e`; Playwright uses Node 24 for its runner while Bun runs the application and installs dependencies. Unit/domain tests must run without Next.js or infrastructure. Add meaningful regression tests for domain invariants, trust boundaries, and failure paths; avoid implementation-mirroring tests.

Generate migrations with `bun db:generate`, inspect the SQL, and commit migrations plus metadata together. Never edit an applied migration. Explain locking, backfill, rollback, and compatibility implications for production schema changes. Document cross-instance concurrency, idempotency, and retries for competitive writes.

ADRs live under `docs/decisions`. A short decision needs context, tradeoffs, outcome, and consequences. Update relevant documentation in the same PR as the code. Commit the Bun lockfile whenever dependency resolution changes. Use clear commit messages and the PR template; report verification limitations honestly.

CI runs format, architecture lint, strict types, unit tests, production build, migrations, real PostgreSQL/Redis tests, and browser tests. Independent checks run concurrently. Task-output caches are not shared in CI initially; the small foundation favors fresh verification. Bun binary caching comes from setup-bun. Integration/E2E tasks are uncached. Local `bun check` covers static/unit/build gates; external-service checks are separate and explicit.

GitHub Actions are deliberately major-version pinned and checked weekly by Dependabot. Authoritative setup references: [checkout](https://github.com/actions/checkout), [setup-bun](https://github.com/oven-sh/setup-bun), [setup-node](https://github.com/actions/setup-node), [Playwright CI](https://playwright.dev/docs/ci), and [Dependabot options](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference). Review upgrades; do not automatically merge dependency changes. Run `bun audit` during dependency reviews and triage reachable findings.

The initial local repository may have no GitHub remote. After connecting it, activate the CODEOWNERS scaffold with real teams, require the CI jobs in branch protection, and enable required owner review. These settings cannot be enforced by files alone.
