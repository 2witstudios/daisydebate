# Production operations

## Process model

The production unit is `apps/web`: `bun run start` executes
`src/server/start.ts` (requires `NODE_ENV=production`), which prepares the
Next build, serves requests over a custom HTTP server, and owns lifecycle:

- **Draining**: a `draining` flag rejects new requests with 503 while
  in-flight requests finish (SIGTERM/SIGINT; 25s deadline, then forceful
  close). Load balancers should use readiness during deploys.
- **Timeouts**: request 30s, headers 15s, keep-alive 5s; database statements
  5s and locks 2s (adapter level); readiness probes bounded at 2s per
  dependency.
- **Shutdown order**: stop accepting → drain HTTP → close Next → close
  database and Redis pools. Connection pools are process-local resources;
  never shared across instances.

## Health and readiness

- `GET /api/health/live` — process aliveness only. Probe for restarts.
- `GET /api/health/ready` — 200 only when not draining AND PostgreSQL and
  Redis respond within bounds. Probe for traffic routing. Database
  availability is necessary, not sufficient: keep migration state and
  deployment gating in the release pipeline.

## Releases

1. Migrations run once per release as a pipeline step (`bun db:migrate`
   against production with migration credentials), never from every app
   instance, and before enabling dependent code (expand/contract for
   rolling deploys).
2. Provide `APP_VERSION`, `GIT_COMMIT`, `PUBLIC_APP_URL` (HTTPS),
   `DATABASE_URL` (non-development credentials), `REDIS_URL`,
   `REDIS_NAMESPACE`, `LOG_LEVEL`. Configuration refinement fails startup on
   missing identity or insecure defaults — do not work around it.
3. Behind a reverse proxy, set `AUTH_TRUSTED_IP_HEADERS` to the one header
   that proxy overwrites on every request (for example `x-real-ip`), and
   `AUTH_TRUSTED_PROXIES` (IPs or CIDR ranges) only when that header carries
   a hop chain such as `x-forwarded-for`. Never name a header the proxy
   merely forwards: it is client-writable, so clients could forge their auth
   rate-limit identity. Unset, no header is believed and all clients share
   one rate-limit bucket per auth path — safe, but coarse. Invalid header
   names or proxy entries fail auth configuration by field name.
4. Scale horizontally: the app is stateless except pools/logger/draining.
   Multi-instance safety relies on PostgreSQL for truth and Redis for
   coordination; sticky sessions are not part of any design.

## Concurrency contract for mutations

Every competitive mutation (join, ready, ballot, complete, rating update)
must state: transaction boundary, authorization principal, idempotency
semantics (stable command ID + durable key when duplicates are possible),
retry behavior, and conflict policy (optimistic version today; escalate to
pessimistic locking only with evidence of contention). See
`docs/architecture/persistence.md`.

## Security baseline

Secrets only via environment; never in client bundles (server-only config
is imported exclusively from server modules). CSP with per-request nonces:
the proxy generates the nonce and every route renders dynamically (root
layout awaits `connection()`), because statically prerendered pages are
built without the request nonce and would block all framework scripts —
e2e asserts nonce coverage so this pairing cannot silently regress.
`X-Frame-Options: DENY`, `nosniff`, strict referrer policy, HSTS in
production. Mutations require same-origin. Stable public errors never expose
internals; internal causes stay attached for in-process handling and are never
serialized to logs. Rate limiting must
be atomic server-side (Redis) before public mutations ship; in-memory
limiters are not multi-instance enforcement.
