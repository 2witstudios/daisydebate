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

## Delivery phases

### Phase A: Policy baseline

Establish identifier, secret ownership, auth activation, and repository AIDD
policy before implementing the corresponding database migration or routes. Add
the policy gate to local checks, CI, and evidence contracts. This phase does not
perform the cuid2 migration or activate auth routes.

- Given a new application identifier, should use the injected cuid2 boundary,
  never treat a cuid2 ID as a bearer secret, and have deterministic unit
  coverage.
- Given an intentional UUID or framework/tooling/migration exception, should
  have a path, rule, owner, reason, existing ADR reference, and future review
  date before the policy gate can pass.

### Phase B: Identifier migration

Migrate durable application-owned identifiers from the existing UUID contract to
cuid2 using reviewed expand/contract database changes and coordinated protocol
rollout. This phase is intentionally not implemented by the policy PR.

- Given an existing durable UUID identifier, should preserve rollout safety and
  data integrity through a forward, reviewed migration.
- Given a migrated application operation, should persist and validate cuid2 IDs
  while keeping documented framework, migration, and protocol exceptions.

### Phase C: Auth security activation

Activate authentication in order: route gate, Principal resolution,
authorization, and atomic rate limiting. Keep Better Auth token/secret ownership
and logging boundaries explicit; no protected route performs durable work before
all gates pass.

- Given an unauthenticated request, should stop at the route gate without
  durable side effects.
- Given a limiter outage, should follow the operation's documented safe failure
  behavior rather than silently allowing an unbounded auth surface.

### Phase D: Maintenance hardening

Keep policy exceptions reviewed, dependencies and ADR references current, and
parallel work isolated. Use `pu` for parallel or isolated agents; direct
single-agent work remains valid without it. The orchestrator owns task-board
updates and delegated agents own only their assigned worktree. See
`docs/development/pu-workflow.md`.

- Given an exception whose review date or ADR becomes invalid, should fail the
  policy gate until the owner renews or removes it.
- Given parallel agent work, should use isolated `pu` worktrees and safe
  cleanup; given single-agent work, should not require `pu`.

## Conflicts resolved before implementation

The React skill's global ECS context convention conflicts with the requested domain encapsulation; the explicit architecture wins. No Adobe React dependency is added. The TypeScript skill's single src hierarchy does not fit an explicitly requested monorepo; shared strict config with workspace checks plus enforced dependency graph replaces that layout. Current TypeScript 7 is outside typescript-eslint's supported range: pin stable 6.0.3. Drizzle's current guide advertises a release candidate: verify and use stable 0.45.2 APIs instead. Native Bun adapters require Bun for both development and production Next execution; Node-only/serverless deployments require a separate ADR and adapters.
