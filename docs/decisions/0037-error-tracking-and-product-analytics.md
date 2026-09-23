# 0037: Error tracking and product analytics

Status: accepted. Amends [ADR 0015](0015-event-stream-as-observability-source-of-truth.md)
(the event stream stays the operational source of truth; a vendor adapter
never replaces it) and the "vendors belong to deployment" line of
[observability.md](../operations/observability.md), which until now read
that adding a vendor SDK requires an ADR without saying which vendors or
under what constraints. Applies the classification of
[ADR 0036](0036-privacy-by-design.md) to the Sentry and PostHog surfaces.

## Context

Daisy has no error tracker and no product analytics. Owner decision
(2026-09-22): build both vendor seams and both adapters now — Sentry for
error tracking, PostHog for product analytics — rather than defer them
again once features are shipping. US-first, GDPR-ready: the full set of
controls ships now, and only the vendor region is a deploy-time setting.
Both adapters must stay inert until their environment keys are set, so a
checkout with no keys makes no vendor network call and boots identically
to today.

## Decision

### Error tracking (Sentry)

- An `ErrorReporter` port, `capture(error, { requestId, route, userId?,
errorCode })`, lives in `apps/web/src/features/telemetry/`, with a no-op
  default and a `@sentry/nextjs` adapter. The context type accepts only
  those four fields — `actorId` is not a valid field and fails typecheck,
  matching ADR 0036's "never `actorId`" rule for the error surface.
- Call sites: `instrumentation.ts` `onRequestError`, the failure path of
  `handleOperation`, and the client `global-error` boundary.
- `scrubEvent`, a pure function, runs as `beforeSend`: `sendDefaultPii:
false`, drops the request body, cookies, headers, query string, IP and
  console breadcrumbs, sets `user = { id }` with the cuid2 id only, and
  turns off session replay on the Sentry side (product-analytics replay is
  PostHog's, gated separately below).
- **Raw exceptions go only to the scrubbed error tracker, after
  `scrubEvent`, and never to logs.** Logs keep safe structured metadata:
  `errorCode`, `errorClass`, `operation`, `invariantId` and `requestId`.
  `errorClass` is a controlled enum of normalized internal failure types —
  `db.timeout`, `redis.unavailable`, `vendor.http`, `validation`,
  `invariant` and similarly named cases — declared once in the log-field
  vocabulary (PRIV-2). It is never the exception's class name or message,
  so a log line stays useful for diagnosis and dashboards without ever
  carrying raw content, and it lets a log line be joined to its Sentry
  event through the shared `requestId` without the log itself needing the
  exception.
- `apps/realtime` reports errors through the same `ErrorReporter` port and
  the same scrubbing; it is not a lesser-monitored surface because it runs
  outside `apps/web`.
- With no `SENTRY_DSN`, the SDK is not initialized and makes no network
  request. `@sentry/*` imports outside the adapter module are rejected by
  the policy gate (PRIV-5).

### Product analytics and consent (PostHog)

- A product event registry (`apps/web/src/features/analytics/events.ts`)
  gives every event a strict property schema; personal, sensitive and
  secret properties are rejected by the type system and a registry test,
  per ADR 0036's classification. `track(event, props)` runs on client and
  server and is a no-op with no key set.
- The PostHog client SDK sits behind an **opt-in** consent banner (owner
  decision, 2026-09-22), never behind default tracking with an opt-out.
  Before opt-in: `opt_out_capturing_by_default: true`,
  `persistence: 'memory'`. After opt-in: cookie persistence.
  `person_profiles: 'identified_only'`; `identify` is called with the cuid2
  id only. Session replay is gated separately on the `replay` consent
  category, with `maskAllInputs`. The server-side `track` checks the
  request's consent cookie before sending anything.
- Analytics events carry exactly one of `anonymousId` or `userId`, and
  `actorId` only on an event the registry declares `competitive: true`
  (ADR 0036 §2); this ADR does not restate that rule, it only points the
  PostHog adapter at it.
- With no PostHog key, the analytics category is hidden from the UI and
  the SDK is never initialized, while the stored consent schema still
  keeps all three categories per ADR 0036 §5. `posthog-js`/`posthog-node`
  imports outside their adapter are rejected by the policy gate (PRIV-6).

### Configuration and region

All vendor variables are optional in `packages/config`, and an adapter
initializes only when its variables are present:

- `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `NEXT_PUBLIC_SENTRY_DSN`
- `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` (region)
- `POSTHOG_API_KEY` (server-side events and person deletion)

The vendor region (US-first, GDPR-ready) is chosen by which host and DSN a
deployment sets, never by application code. `proxy.ts`'s CSP allows the
configured Sentry and PostHog hosts only when their variables are set, so
an unconfigured deployment's CSP names no vendor host at all.

## Consequences

- `docs/operations/observability.md`'s "vendors belong to deployment; adding
  an SDK requires an ADR" line is superseded for Sentry and PostHog
  specifically: this ADR is that ADR, and both adapters ship in-repo,
  inert without keys. The line stands unchanged for any other vendor.
- PRIV-2 adds `errorClass` to the closed log-field vocabulary and its enum.
- PRIV-5 implements the `ErrorReporter` port, the `@sentry/nextjs` adapter,
  `scrubEvent`, configuration and the import/capture policy ban.
- PRIV-6 implements the product event registry, the consent banner and
  model (mechanism only — the model itself is ADR 0036 §5), the
  `consent_record` table, the PostHog adapter and its policy ban.
- `docs/dependencies.md` registers `@sentry/nextjs`, `posthog-js` and
  `posthog-node` as adopted by this ADR; PRIV-1 records the rows without
  installing the packages, which the stage-2 PRs (PRIV-5, PRIV-6) install
  alongside the adapter code.
- Vendor account creation, DPAs, region sign-off and deploy secrets stay
  PRIV-H, a human-only leaf; this ADR fixes the mechanism, not the sign-off.

## Sources

- Sentry Next.js SDK, `beforeSend` and PII controls:
  https://docs.sentry.io/platforms/javascript/guides/nextjs/
- Sentry data scrubbing (`sendDefaultPii`, server-side scrubbing):
  https://docs.sentry.io/platforms/javascript/guides/nextjs/data-management/sensitive-data/
- PostHog JS opt-out and persistence configuration:
  https://posthog.com/docs/libraries/js
- PostHog person profiles and `identify`:
  https://posthog.com/docs/product-analytics/identify
- PostHog session replay input masking:
  https://posthog.com/docs/session-replay/privacy
- PostHog person deletion API (server-side erasure):
  https://posthog.com/docs/api/persons
