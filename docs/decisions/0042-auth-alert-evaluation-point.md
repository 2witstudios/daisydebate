# 0042: The AUTH-7.7 alert evaluation point runs outside the app

Status: accepted. Extends [ADR 0015](0015-event-stream-as-observability-source-of-truth.md)
(the event stream stays the source of truth; this ADR only adds a
derived, durable read of it) and follows AGENTS.md's standing rule that
Redis state be validated, namespaced keys with expiry. Applies
[ADR 0036](0036-privacy-by-design.md)'s
classification to every new field. Builds on
[docs/operations/observability.md](../operations/observability.md)'s
existing "alert on `auth.rate_limit.unavailable`, `auth.session.unavailable`
and `auth.mail.failed`" line by shipping the mechanism that line only
described as intent.

## Context

AUTH-7.7 asks for four tested alert conditions delivered to an operator
(storage/limiter unavailable 2 minutes, 3 consecutive delivery-provider
failures, auth 5xx above 1% over 10 minutes with at least 100 requests,
cleanup missed 2 hours), bounded-cardinality dashboards, and a 5-minute
non-mutating health/session probe of the final public origin — all without
a new alerting service or vendor, using the existing PageSpace Incidents
path (`scripts/notify-drive.ts incidents`, owner decision 2026-09-25).

The design constraint that forces a real decision: staging's `fly.toml` sets
`min_machines_running = 0`. An evaluator running inside the Next.js process
cannot notice its own two-hour silence while the process itself is asleep,
and cannot alert on its own unavailability while it is down or
crash-looping — the one failure mode most worth alerting on is exactly the
one an in-process timer cannot see.

## Decision

**The evaluator is a scheduled GitHub Actions workflow
(`.github/workflows/auth-alerts.yml`), not a timer inside the app.**
Configured for every 5 minutes (`cron: '*/5 * * * *'`) — though GitHub's
`schedule` trigger does not actually deliver that cadence in production;
see the corrected cadence below (ADR 0046/DEC-33). Each run it:

1. Sends one non-mutating `GET /api/health/ready` to the public origin and
   checks the response status (routing: an expected 200), the fact the
   `fetch` completed at all against an `https://` URL (TLS: an invalid or
   expired certificate throws before any status returns — no separate
   certificate-inspection library), and the fixed security-header contract
   `next.config.ts` already sets on every response
   (`X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`,
   `Referrer-Policy`). This is AUTH-7.7's "5-minute, non-mutating health and
   session probe of the final public origin" criterion; a request that
   reaches a sleeping app also wakes it (`auto_start_machines`), so the
   probe cadence itself keeps staging from staying asleep across a full
   cycle without also being the thing that would hide unavailability.
2. Reads the already-evaluated conditions from `GET /api/ops/alerts`, a new
   bearer-token-gated endpoint the app itself serves.
3. Posts whatever fired to the Incidents channel via the existing
   `bun scripts/notify-drive.ts incidents --message`, naming each
   condition's own runbook section in `docs/operations/auth-delivery.md`.

`scripts/auth-alert-probe.ts` is the workflow's script: pure
`evaluateOriginProbe`/`composeAlertMessage` functions, unit-tested, plus a
thin `main()` that performs the two fetches and shells out to
`notify-drive.ts`. It never reimplements a threshold — those live in
exactly one place.

**Where each condition's state lives, and why:**

- **Storage/limiter unavailable.** The app already emits
  `auth.session.unavailable`/`auth.rate_limit.unavailable`. A new
  `withAlertRecording` tap around the composed `Logger` (`app.ts`) observes
  every event the app already logs and, for these two, writes a
  first-observed timestamp to Redis with `markOccurrenceSince` (an atomic
  Lua primitive: `SETNX`+`PEXPIRE` on the first occurrence, `PEXPIRE` only
  — keeping the original since-value — on every later one) under a
  3-minute TTL, re-armed on every occurrence — long enough to bridge a gap
  between two failures of the same incident without pinning the "since"
  time to the most recent one, and to keep that since-time alive for the
  whole length of a continuous outage rather than only its first 180s
  (ISSUE-156). A quiet period longer than the TTL resets the next
  incident's clock. `evaluateAlerts` fires once `now - since >= 2 minutes`.
- **Consecutive delivery-provider failures.** `auth.mail.failed` increments
  a bounded Redis counter (`incrementWithExpiry`, a new atomic
  `INCR`+`PEXPIRE`-on-first-hit primitive) with a 1-hour TTL;
  `auth.mail.sent` deletes it. Fires at 3.
- **Auth 5xx rate.** `http.ts` now logs `status` on `http.request.failed`
  too (previously only `http.request.completed` did, which undercounted
  thrown-error responses — the majority of real 5xx). The tap increments a
  per-minute Redis counter for both the total and 5xx-only count, scoped to
  operations whose name starts with `auth.` (bounded: the auth route
  surface is a small, known set of operation names, never a raw path).
  `readAlertSnapshot` sums the trailing 10 one-minute buckets (each with an
  11-minute TTL) and fires at `total >= 100 && serverErrors/total > 0.01`.
- **Cleanup missed.** `retention.sweep.completed` sets a durable
  `alert-retention-last-success` marker (30-day TTL, effectively
  "durable" relative to the 2-hour threshold); `retention.sweep.failed`
  touches nothing, so a persistently failing or never-running sweep goes
  stale on its own. Fires at `now - lastSuccess >= 2 hours`, or immediately
  if the marker has never been set at all (covers "a sweep that never
  ran" — accepted trade-off: a fresh deploy can show this condition for the
  few seconds between boot and the `runOnStart` sweep's first completion,
  a window no probe run — at any cadence — is likely to land inside).

**Redis, not Postgres, holds every alert marker**, including the retention
one, even though ADR 0023/persistence.md name PostgreSQL the source of
competitive truth and Redis expendable. This is a deliberate, bounded
trade-off: Fly Redis for this deployment is Upstash, a managed service
independent of the web app's machines (`docs/operations/deploy-staging.md`),
so it does not scale to zero with the app and normally survives exactly the
outage this system exists to detect. The failure mode this accepts — an
operator-initiated Redis flush silently resetting `alert-retention-last-success`
to "unknown" — produces at most one avoidable `cleanup_missed` alert cycle,
never a missed one, and adds no new migration, table, or write path to the
sweep's own transaction. A durable Postgres row was considered and rejected
for this reason: the leaf's own alerting requirement does not justify a
second write path into the retention sweep's already-carefully-bounded
transaction boundary (`retention.ts`'s comment on why batches are never
wrapped in one transaction).

**`/api/ops/alerts` and `/api/ops/metrics` are gated by one new
`OPS_PROBE_TOKEN`** (`packages/config`'s `REQUIRED_IN_PRODUCTION` list),
compared as SHA3-256 digests rather than raw strings (ADR 0019's
secret-comparison rule). Both are non-mutating `GET`s, `handleOperation`-wrapped
like every other route, and each route handler's own closure reads
`app.opsProbeToken()` lazily, per request, rather than at route-table
construction — the same treatment `confirmAuth` already gets elsewhere in
`routes.ts` (ADR 0020: a bare, unactivated `App` instance never requires
auth variables just to exist). That per-request laziness is not the same
claim as "optional in production": `apps/web/src/server/start.ts:25` calls
`app.auth().config` unconditionally before the server ever listens, and
`readAuthConfig`'s production `superRefine` (`packages/config/src/index.ts`)
requires `OPS_PROBE_TOKEN` there exactly like `RESEND_WEBHOOK_SECRET` — a
production deploy with no `OPS_PROBE_TOKEN` set refuses to boot, the same
fail-closed shape as every other required auth secret, not a route that
quietly 401s while the rest of the app runs.

**Bounded-cardinality dashboards are an in-process Prometheus text
exposition endpoint (`/api/ops/metrics`), not a new vendor.** Counters:
auth HTTP responses by status class (`2xx`/`3xx`/`4xx`/`5xx` — 4 values),
rate-limit denied/unavailable totals, mail delivery failure total, and
retention sweep failures by target name (`retentionTargets`' own fixed set
of ~6 names). No field is ever an email, token, IP, or other unbounded
value. Prometheus text exposition was chosen because it needs no client
library (plain string formatting) and is the format Fly's own `[metrics]`
scrape config and any Prometheus-compatible dashboard already understand;
this ADR ships the data source only. **Wiring an actual scrape config
(`fly.toml`'s `[metrics]` block) or a rendered dashboard is a deploy-rail
change and stays with the owner** (AGENTS.md: "Deploy-rail and
production-data changes require a human-only sign-off leaf; agents never
self-approve") — tracked as a follow-up, not built here.

**Privacy classification.** Every new Redis marker and metrics counter is
category `none` under ADR 0036 §1: a timestamp, a bounded count, or a fixed
enum label (status class, retention target name) — never an email, token,
IP, or other identifier. `packages/db/src/schema/data-inventory.ts` (the
single declaration ADR 0036 §3 and privacy.md describe) does not exist yet
for any Redis key, including the pre-existing rate-limit and presence
namespaces; this ADR follows that same not-yet-built state rather than
introduce a one-off inventory file for only these new keys. When PRIV-3
lands, the `alert-*` keys and `/api/ops/metrics`'s counters classify as
`none` alongside the rest of `packages/redis`'s namespaces.

**Known limitations, accepted rather than engineered around:**

- **Corrected by [ADR 0046](0046-auth-alert-probe-cadence-correction.md):**
  this bullet originally read "GitHub's `schedule` trigger is best-effort
  and can run a few minutes late under platform load." Measured over 43.5
  hours (ISSUE-157), the real gap between runs is 2–5 hours, not minutes —
  GitHub's own docs describe delays "as much as 15 minutes, or even longer,"
  and this deployment falls well past even that. The 2-minute and
  10-minute alert windows lapse between runs at the cadence actually
  observed; only the 2-hour `cleanup_missed` condition reliably survives
  the gap between scheduled runs on its own. **Owner decision (DEC-33,
  2026-09-28): keep this exact mechanism and accept its best-effort
  cadence** rather than build an always-on in-app evaluator or a dedicated
  prober machine; DEC-10's five-minute figure is amended to best-effort for
  staging. Proving the other three conditions live uses an independent
  trigger plus `workflow_dispatch`, not the schedule itself (ISSUE-157-AC2).
- `/api/ops/metrics` counters are per-process (reset on restart, not
  aggregated across instances in-app) — the normal Prometheus convention; a
  scraper aggregates across instances and restarts at query time, not this
  endpoint.
- Alerts do not deduplicate across probe runs: a condition that stays true
  re-alerts on every run until it clears — at the real, best-effort cadence
  (ADR 0046/DEC-33), not every 5 minutes. AUTH-7.7 asks for a fired,
  runbooked alert, not an incident-management system; silencing is an
  operator action via the runbook, not a feature this ADR adds.
- **The probe cadence was expected to keep staging effectively always-on;
  it does not, because the real cadence is hours apart, not 5 minutes
  (ADR 0046).** Each real run's `GET /api/health/ready` (and the follow-on
  `GET /api/ops/alerts`) does wake or keep awake the web machine for that
  one cycle, but between real runs — 2 to 5 hours apart, measured — the
  machine sleeps for hours under `fly.toml`'s `min_machines_running = 0`
  exactly as scale-to-zero intends; it does not stay running continuously.
  **Owner decision DEC-10 (confirmed, amended by DEC-33/ADR 0046,
  2026-09-28)**: keep this mechanism and accept its real cadence, which
  costs meaningfully less than the ~$4/month DEC-10 originally priced in
  for a true 5-minute always-on cycle — see
  `docs/operations/deploy-staging.md`'s idle-cost table.

## Consequences

- `packages/redis`: `markOccurrenceSince`, `incrementWithExpiry` (new atomic
  primitives).
- `packages/config`: `OPS_PROBE_TOKEN` (new, production-required auth
  field).
- `apps/web`: `alert-state.ts` (pure `evaluateAlerts`/`readAlertSnapshot`),
  `alert-recorder.ts` (`createAlertRecorder`, `withAlertRecording`),
  `metrics-store.ts`, `features/ops/{alerts,metrics,probe-auth}.ts`, two new
  routes (`/api/ops/alerts`, `/api/ops/metrics`), and `http.ts` now logs
  `status` on `http.request.failed`.
- `scripts/auth-alert-probe.ts` and `.github/workflows/auth-alerts.yml`
  (new scheduled workflow, SHA-pinned actions, secrets scoped to one step
  per ADR 0040).
- `docs/operations/auth-delivery.md` gains one runbook subsection per
  condition plus the probe; `.env.example` and every test harness that
  boots a production-mode app (`playwright.config.ts`,
  `scripts/auth-load/two-instances.ts`) gain an inert `OPS_PROBE_TOKEN`
  placeholder.
- A follow-up (filed as an Issue, see the AUTH-7.7 handoff) tracks wiring
  `/api/ops/metrics` into an actual scrape config/dashboard — an owner
  deploy-rail decision, not part of this change.

## Sources

- Fly.io scale-to-zero and `auto_start_machines`/`min_machines_running`:
  https://fly.io/docs/reference/configuration/#the-http_service-section
- Fly.io metrics and Prometheus scraping:
  https://fly.io/docs/reference/metrics/
- Prometheus text exposition format:
  https://prometheus.io/docs/instrumenting/exposition_formats/
- GitHub Actions `schedule` trigger reliability notes:
  https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule
