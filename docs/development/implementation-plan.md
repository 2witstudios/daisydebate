# Bootstrap plan

1. Bun workspace packages use explicit source exports, strict TypeScript and a Turbo DAG. Stable exact dependencies have official references and compatibility notes.
2. Enforce app → application/domain contracts; infrastructure adapts inward. No framework, persistence, or Adobe types leak from the domain API.
3. Create engine, protocol, errors, auth, config, db, redis, logger, observability and TypeScript-config packages. UI/validation/testing packages wait until real shared consumers exist.
4. Next App Router provides named route shells, root/error/loading/not-found boundaries, nonce CSP, request correlation, liveness/readiness and a separate development proof route.
5. Engine privately adapts pinned Adobe ECS; deterministic transactions and portable snapshot restoration prove invariants without booting Next.
6. PostgreSQL + reviewed Drizzle migrations store small user/debate schema; database adapter maps snapshots without owning domain rules.
7. Bun native Redis owns namespaced ephemeral values and lifecycle, with real integration tests.
8. Protocol carries versioned commands, facts, snapshots and stable errors; validate at transport boundaries.
9. Typed environment parsing separates public and server-only inputs and rejects insecure production defaults.
10. Pino abstraction and provider-neutral OpenTelemetry boundary tracing correlate meaningful operations and deployment metadata.
11. Fast Bun tests, isolated PostgreSQL/Redis integrations, Playwright browser checks, production build and mechanical architectural checks prove the layers.
12. GitHub Actions runs frozen install and independent checks, plus real service integrations/build/browser tests. Runtime/toolchain is deliberately pinned.
13. ADRs, package responsibilities, dependency registry, contribution guide, ownership scaffold and focused operational runbooks support parallel engineers.
14. Review shutdown, bounded waits, readiness degradation, config/secrets, multiple instances, idempotency and deployment migration behavior before final verification.

## Policy phases

15. Establish identifier, secret ownership, auth activation, and repository AIDD
    policy before implementing the corresponding database migration or routes.
    See ADRs 0018-0021 and `policy/exceptions.json`.
16. Add the policy gate to local checks, CI, and evidence contracts. Policy work
    does not perform the cuid2 migration or activate auth routes.
17. Use `pu` as the preferred orchestration path for parallel agents and
    worktrees; direct single-agent work remains valid without it. The
    orchestrator owns task-board updates and delegated agents own only their
    assigned worktree. See `docs/development/pu-workflow.md`.

## Acceptance criteria

- Given a new application identifier, should use the selected injected cuid2
  boundary and have deterministic unit coverage.
- Given durable behavior, should have a real integration test through the
  application operation, with service guards that fail rather than skip.
- Given an intentional UUID/framework/tooling/migration exception, should have a
  path, rule, owner, and reason in the registry before the check can pass.
- Given parallel agent work, should use isolated `pu` worktrees and leave task
  board updates to the orchestrator; given single-agent work, should not require
  `pu`.

## Conflicts resolved before implementation

The React skill's global ECS context convention conflicts with the requested domain encapsulation; the explicit architecture wins. No Adobe React dependency is added. The TypeScript skill's single src hierarchy does not fit an explicitly requested monorepo; shared strict config with workspace checks plus enforced dependency graph replaces that layout. Current TypeScript 7 is outside typescript-eslint's supported range: pin stable 6.0.3. Drizzle's current guide advertises a release candidate: verify and use stable 0.45.2 APIs instead. Native Bun adapters require Bun for both development and production Next execution; Node-only/serverless deployments require a separate ADR and adapters.
