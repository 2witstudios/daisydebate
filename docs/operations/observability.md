# Observability

Provider-neutral OpenTelemetry instrumentation exists from day one; vendors
and exporters belong to deployment, not the repository.

## Current state

- `@daisy/observability` wraps the OTel API only: `withSpan` for meaningful
  boundaries, `currentTraceId`, request-ID correlation, `withTimeout` for
  bounded waits. Without a provider installed, spans are no-ops — cheap and
  safe.
- `apps/web/src/instrumentation.ts` registers server runtime initialization
  and `onRequestError`, tagging unhandled failures with route, request ID,
  and deployment identity.
- `handleOperation` (web server layer) binds a request-scoped child logger with
  `operation`, `requestId`, and `traceId`, then emits
  `http.request.completed`, `http.request.cancelled`, or `http.request.failed`
  with structured lifecycle fields — never formatted strings.
- The Next Proxy validates an ingress `traceparent` before forwarding it; the
  HTTP boundary extracts that W3C context as the parent of the request span.
- The logger embeds `appVersion` and `gitCommit` (deployment identity) in
  every line; production config refuses to boot without them.
- Logger events use a compile-time vocabulary and registry-declared severity;
  callers emit through one event-based method, and untrusted runtime event
  names normalize to `telemetry.unknown_event`. Dynamic operation names remain
  structured context fields.
- Database and Redis adapters accept provider-neutral injected event sinks and
  emit `db.query.failed` or `redis.command.failed` with the operation name when
  an external query or command fails. They rethrow the original failure and do
  not depend on the logger package.

## How to answer production questions

Which request failed / what else happened to it: correlate `requestId`
(proxy-generated at the edge, echoed on responses and error bodies; the
operation layer also honors well-formed caller IDs when the proxy is bypassed)
with `traceId` once a provider is installed. Which deployment:
`appVersion`/`gitCommit` log fields. Which user/debate: pass
`userId`/`debateId` as structured fields at feature-operation level — add
them where the operation knows them, not by re-parsing payloads.

## Rules

- Instrument meaningful boundaries (HTTP operations, adapter calls,
  scheduled work), not every function.
- Never log credentials, cookies, raw request bodies, or raw exceptions;
  pino redaction is defense in depth, not permission.
- Exporters/SDK: install at deployment edge (collector sidecar or platform
  integration). Adding an SDK to application packages requires an ADR.
- Next.js instrumentation hooks are the supported framework surface; do not
  invent framework-specific telemetry.
