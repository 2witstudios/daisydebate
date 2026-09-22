# Observability

Provider-neutral OpenTelemetry instrumentation exists from day one; vendors
and exporters belong to deployment, not the repository.

## Source of truth

The structured event stream emitted by `@daisy/logger` is the operational
source of truth. Query the JSON log entries for what happened; use `traceId`
and metrics as supplementary correlation and aggregation. A trace may be
absent when the deployment has no OpenTelemetry provider, but lifecycle and
failure events still go to the logger destination. The logger event registry
is the source of truth for the permitted event names and their severities,
not a history of emitted events. See [ADR 0015](../decisions/0015-event-stream-as-observability-source-of-truth.md).

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

## Event registry

The logger currently accepts these events. The registry, rather than caller
selected log levels, controls severity:

| Event                         | Severity | Meaning                                                                                                |
| ----------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `runtime.initialize`          | info     | The application runtime initialized                                                                    |
| `server.start`                | info     | The HTTP server began listening                                                                        |
| `server.shutdown`             | info     | Shutdown began draining requests                                                                       |
| `http.request.completed`      | info     | A request operation returned a response                                                                |
| `http.request.cancelled`      | warn     | A client/request signal aborted before completion                                                      |
| `http.request.failed`         | error    | A request operation or server handler failed                                                           |
| `invariant.violated`          | error    | A request operation violated a registered invariant                                                    |
| `auth.rate_limit.denied`      | warn     | The auth rate-limit gate denied a request (public 429)                                                 |
| `auth.rate_limit.unavailable` | error    | The auth limiter or client resolution failed; denied with a public 503                                 |
| `auth.session.unavailable`    | error    | The session store could not be read; guarded pages and the username claim answer 503, never a sign-out |
| `auth.mail.sent`              | info     | An auth email was handed to the mail transport                                                         |
| `auth.mail.failed`            | error    | Auth email delivery failed                                                                             |
| `request.unhandled`           | error    | Next reported an unhandled request failure                                                             |
| `db.query.failed`             | error    | A database query or transaction failed                                                                 |
| `redis.command.failed`        | error    | A Redis command failed                                                                                 |
| `telemetry.unknown_event`     | warn     | An unregistered runtime event name was normalized                                                      |

Lifecycle events describe runtime, server, and request progress. Failure events
describe invariant violations, unhandled requests, and adapter failures;
`http.request.cancelled` is an expected client-abort signal and is intentionally
warning-level rather than an error. Invariant events carry only the stable
`invariantId`; adapter events preserve the original failure for the caller to
handle and record only the safe operation context. Auth events carry only
`operation`, the stable auth route `path`, and an `errorCode`: never the
recipient, token, link URL, client address, limiter key, or provider
exception. `auth.rate_limit.denied` is expected traffic and is warning-level;
alert on `auth.rate_limit.unavailable`, `auth.session.unavailable` and
`auth.mail.failed`.

## How to answer production questions

Which request failed / what else happened to it: correlate `requestId`
(proxy-generated at the edge, echoed on responses and error bodies; the
operation layer also honors well-formed caller IDs when the proxy is bypassed)
with `traceId` once a provider is installed. Which deployment:
`appVersion`/`gitCommit` log fields. Which user/debate: pass
`userId`/`debateId` as structured fields at feature-operation level — add
them where the operation knows them, not by re-parsing payloads.

For an incident, start with the event stream and filter by `event`, then
correlate `requestId`, `traceId`, `operation`, and deployment fields. The
registry alone cannot answer when an event occurred or which request emitted
it; those facts exist only in the emitted entries.

## Rules

- Instrument meaningful boundaries (HTTP operations, adapter calls,
  scheduled work), not every function.
- Never log credentials, cookies, raw request bodies, or raw exceptions;
  pino redaction is defense in depth, not permission.
- Exporters/SDK: install at deployment edge (collector sidecar or platform
  integration). Adding an SDK to application packages requires an ADR.
- Next.js instrumentation hooks are the supported framework surface; do not
  invent framework-specific telemetry.
