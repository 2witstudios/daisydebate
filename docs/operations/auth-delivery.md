# Authentication delivery and abuse protection

Operational contract for `/api/auth/*`, `/auth/confirm` and
`/api/webhooks/resend` (ADR 0025). Full incident runbooks belong to the
observability leaf (AUTH-6.4); this page holds the facts operators need to
deploy and to reason about failures.

## Required configuration (production refuses to start without it)

| Variable                | Purpose                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`    | 64 characters from 32 random bytes; also keys recipient hashes                                                                        |
| `PUBLIC_APP_URL`        | HTTPS canonical origin; derives the passkey RP ID and origin                                                                          |
| `RESEND_API_KEY`        | Resend send credential (owner-provisioned; never in PageSpace)                                                                        |
| `AUTH_EMAIL_FROM`       | Verified sender mailbox                                                                                                               |
| `RESEND_WEBHOOK_SECRET` | `whsec_…` signing secret of the Resend webhook                                                                                        |
| `AUTH_TRUSTED_PROXIES`  | Optional IP/CIDR list of deployment ingress hops (see below)                                                                          |
| `OPS_PROBE_TOKEN`       | Bearer credential for `/api/ops/alerts` and `/api/ops/metrics` (AUTH-7.7); the scheduled `auth-alerts.yml` workflow's only credential |

`apps/web/src/server/start.ts` validates these at boot and reports field names
only. Live delivery additionally needs the human prerequisite AUTH-1.3: a
verified Resend domain (SPF, DKIM, initial DMARC monitoring policy) with
**open and click tracking disabled** — tracking is a domain-level Resend
setting the message API cannot override — and a webhook pointing at
`https://<origin>/api/webhooks/resend` subscribed to `email.sent`,
`email.delivered`, `email.delivery_delayed`, `email.failed`, `email.bounced`,
`email.complained`.

## Client identity and ingress assumptions

Rate limits bucket by client. There is exactly one resolver: the composition
trusts only `x-daisy-client-ip`, stamped by our own ingress (`start.ts`) on
every request, replacing any caller value. It is the socket peer, or — only
when the peer is in `AUTH_TRUSTED_PROXIES` — Fly's own authoritative
`Fly-Client-IP` (AUTH-7.9, `client-ip.ts`), falling back to the first
address from the **right** of `X-Forwarded-For` that is not itself a
trusted hop only when `Fly-Client-IP` is absent or unusable, so an
attacker-prepended left-most value never selects the bucket. Better Auth has
no header list of its own to configure: `next dev` runs without the
stamping ingress, so a dev-mode request simply carries no identity and
shares one rate-limit bucket per path with every other unstamped request.

In production, `AUTH_TRUSTED_PROXIES` (with `Fly-Client-IP`, falling back to
`X-Forwarded-For`) is the mechanism for reading the real client behind a
proxy. A proxy not listed there makes all its users share one rate-limit
bucket.

Configure exactly the hops you operate; an over-broad range re-opens spoofing.
Under `next dev` there is no ingress stamp and requests share the loopback
bucket. Verify with the spoofing suite (`auth-ingress.integration.ts`) adapted
to your topology before release.

## Limits and outage behaviour

| Scope                                                     | Limit                         | On exceed                |
| --------------------------------------------------------- | ----------------------------- | ------------------------ |
| Any auth route, per client and path                       | 100 / 60 s                    | `429` + `Retry-After`    |
| Magic-link request, per client                            | 3 / 60 s                      | `429` + `Retry-After`    |
| Magic-link request, per recipient                         | 3 / 60 s, 10 / hour, 20 / day | `429` + `Retry-After`    |
| Email change, per new address (ISSUE-121)                 | 3 / 60 s, 10 / hour, 20 / day | `429` + `Retry-After`    |
| Sign-up link (address with no account), whole application | 120 / 60 s, 3,000 / day       | `429` + `Retry-After`    |
| Redis unavailable                                         | —                             | `503` + `Retry-After: 5` |

The whole-application ceilings never count or deny a sign-in link for an
existing account (ADR 0025, ISSUE-54): a drained ceiling delays new
sign-ups only.

The sign-in page offers passkeys in browser autofill, so every visible view
spends one `/passkey/generate-authenticate-options` request (a challenge row
and a slot in that path's bucket) without a click. The page renews it every
4 minutes, before the 5-minute challenge lifetime ends, and re-offers after
any other ending, backing off from 1 s up to 4 minutes while endings keep
arriving quickly, so a failing service is never hammered. A hidden tab
pauses: every tab shares one challenge cookie, and a background renewal
would invalidate another tab's ceremony. Clients behind one untrusted
address share that bucket with the explicit passkey button.

There is no in-process fallback: while Redis is down every auth request that
needs a decision answers `503`. Restore Redis; no state needs replay. Keys
live under `<REDIS_NAMESPACE>:v1:rl:<sha3-256>` and expire with their window:
60 seconds for the per-route and minute buckets, up to a day for the
recipient hour and day ceilings and the whole-application day ceiling.

## Mail failure and bounces

- Provider failure or timeout: the requester sees `503 EMAIL_DELIVERY_FAILED`
  and may retry; the unsent token is never delivered and expires unused.
- Hard bounce or complaint: the address is suppressed (`email_suppression`,
  keyed hash only). Requests for it answer `422 EMAIL_UNDELIVERABLE` with
  guidance to use a passkey or another address; existing sessions and passkeys
  are untouched. No auth mail is sent to it at all: an email change to or
  from it is refused when requested, before any approval mail (a change to
  it with the same `422`, a change from it with `422
CURRENT_EMAIL_UNDELIVERABLE`), and a passkey added/removed notice
  is skipped and logged as `auth.mail.suppressed` (ADR 0025). Clearing a suppression is an explicit operator action on that
  table and should follow confirmation that the mailbox is fixed.
- Diagnostics: `email_delivery` (message ID, status rank, recipient hash) and
  `email_delivery_event` (event ID dedupe). Neither holds an address or a
  payload. The retention sweep deletes event rows 30 days after receipt and
  delivery rows 30 days after their last status change; suppressions are
  never pruned.
- Webhooks that fail signature or tolerance answer `400`. An event for a
  message with no `email_delivery` row is handled by the event's provider
  timestamp (`created_at`): less than two minutes old, it answers `503` with
  `Retry-After: 5` so the provider retries (the receipt may still be
  committing); older, or with no usable timestamp, it answers `200` and is
  discarded.
- Receipt write failure after the provider accepted a message: the request
  still succeeds (the user has the email) and `auth.mail.receipt_failed` logs
  the opaque `providerMessageId`, nothing else about the message. With no
  `email_delivery` row, that message's bounce or complaint is retried while it
  is under two minutes old, then answered `200` and discarded, so no
  suppression is written. Reconcile by finding the message ID in the log.

## Retention of verification records

Every emailed link writes a `verification` row. The identifier is the
purpose and the SHA3-256 digest of the token (`sign-in:…`,
`email-change-approve:…`, `email-change-verify:…`), never the token itself.
The subject is inside `value`: the requested email for sign-in, and the
account id plus both addresses for an email change (ADR 0025). Redeeming deletes the row; unredeemed rows
are purged by the retention sweep in each server process (once at start-up,
then hourly), only once expired for more than 24 hours, at most 20 batches of
500 per run (a bigger backlog drains over later runs). Runs are idempotent and
safe across instances (`SKIP LOCKED`). On shutdown the sweep stops between
batches and the server waits for it before closing the database, so a normal
restart never raises a false failure. Events, with
`operation: 'retention.verification'`: `retention.sweep.completed`
(`deleted`, `batches`) and `retention.sweep.failed` (alert on this one; a
failing run is retried next hour).

No manual action is needed. To purge sooner, restart a server instance (it
cleans once at start-up) or run one bounded batch in `psql`, repeating until it
reports `DELETE 0`:

```sql
DELETE FROM verification WHERE id IN (
  SELECT id FROM verification
  WHERE expires_at < now() - interval '24 hours'
  ORDER BY expires_at LIMIT 500 FOR UPDATE SKIP LOCKED);
```

## Retention of sessions (AUTH-7.5)

A session that is signed out of is deleted immediately, in the same
transaction that revokes it (`revokeOtherSessions`,
`revokeSessionUnlessAddressHeld`); the sweep below never sees a revoked
session, only one that ran to its own `expires_at` and was never signed out
of. Those rows, `ip_address` and `user_agent` included, are purged by the
same hourly, idempotent sweep as `verification`, with the same 24-hour
grace, `SKIP LOCKED` batches (at most 20 of 500 per run) and shutdown
behaviour. Events, with `operation: 'retention.session'`:
`retention.sweep.completed` (`deleted`, `batches`) and
`retention.sweep.failed` (alert on this one; a failing run is retried next
hour).

No manual action is needed. To purge sooner, restart a server instance or
run one bounded batch in `psql`, repeating until it reports `DELETE 0`:

```sql
DELETE FROM session WHERE id IN (
  SELECT id FROM session
  WHERE expires_at < now() - interval '24 hours'
  ORDER BY expires_at LIMIT 500 FOR UPDATE SKIP LOCKED);
```

## Alerting (AUTH-7.7)

Staging scales to zero (`fly.toml`'s `min_machines_running = 0`), so the
evaluation point for these alerts is a scheduled GitHub Actions workflow
(`.github/workflows/auth-alerts.yml`, `scripts/auth-alert-probe.ts`), not a
timer inside the app — see [ADR 0042](../decisions/0042-auth-alert-evaluation-point.md)
for why. Every 5 minutes it probes the public origin's readiness endpoint
(non-mutating, proving routing/TLS/security headers) and reads
`GET /api/ops/alerts` (bearer-token gated by `OPS_PROBE_TOKEN`), which
answers the already-evaluated conditions computed by
`apps/web/src/server/alert-state.ts`'s `evaluateAlerts`. Whatever fires is
posted to the drive's Incidents channel via the existing
`scripts/notify-drive.ts incidents --message`, naming the condition's own
runbook below.

The four conditions, and the durable Redis marker each reads
(`apps/web/src/server/alert-recorder.ts` writes them by tapping the
existing event stream — no new call sites):

| Condition             | Fires when                                                                                      | Marker                                             |
| --------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `storage_unavailable` | `auth.session.unavailable` persists 2+ minutes                                                  | `alert-unavailable-storage`                        |
| `limiter_unavailable` | `auth.rate_limit.unavailable` persists 2+ minutes                                               | `alert-unavailable-limiter`                        |
| `delivery_failures`   | 3+ consecutive `auth.mail.failed`, reset by `auth.mail.sent`                                    | `alert-mail-consecutive-failures`                  |
| `auth_5xx_rate`       | >1% of auth-operation requests are 5xx over the trailing 10 minutes, with at least 100 requests | per-minute `alert-http-total-*`/`alert-http-5xx-*` |
| `cleanup_missed`      | the retention sweep has not completed successfully in 2+ hours, or never has                    | `alert-retention-last-success`                     |

`GET /api/ops/metrics` (same bearer token) exposes the bounded-cardinality
Prometheus counters behind AUTH-7.7's dashboard criterion: auth HTTP
responses by status class, rate-limit denied/unavailable totals, mail
delivery failures, and retention sweep failures by target name — no
per-email or per-token labels. Wiring an actual scrape config or rendered
dashboard is a separate, owner-approved deploy-rail step (ADR 0042).

## Incident runbooks (AUTH-6.4, AUTH-7.7)

Every instruction below is proved by an existing test: the event or status it
names is asserted by the test file/case cited, so a change that breaks the
diagnostic also breaks `bun test:integration` or `bun test src`.

### Mail delivery is failing

**Symptom:** sign-in/passkey-recovery requests answer `503
EMAIL_DELIVERY_FAILED`, or a bounce guidance message (`422
EMAIL_UNDELIVERABLE`) appears for addresses that should be deliverable.

1. Filter the event stream for `event:"auth.mail.failed"` — every occurrence
   is a Resend send that threw or timed out; the fields carry only
   `operation`/`errorCode`, never the recipient or provider exception
   (`apps/web/integration/auth-database-failures.integration.ts`, "delivery
   failure surfaces a safe retryable error").
2. Check the Resend status page/API directly; the application never persists
   the provider exception, by design.
3. If addresses are unexpectedly suppressed, the row is keyed by
   `recipientHash(BETTER_AUTH_SECRET, email)` (SHA3-256 of the secret and the
   normalized address; `apps/web/src/features/auth/mail.ts`), which cannot be
   recomputed from SQL alone — run `bun repl` (or a one-off script) importing
   `recipientHash` with the deployment's secret to look up
   `SELECT reason, created_at FROM email_suppression WHERE recipient_hash =
'<computed hash>'`, or correlate via `auth.mail.receipt_failed`'s
   `providerMessageId` against Resend's dashboard. Suppression only follows a
   hard bounce or complaint
   (`apps/web/integration/auth-mail-suppression.integration.ts`, "a hard
   bounce stops automatic resends"). Clearing a row is a deliberate operator
   action taken only after confirming the mailbox is fixed; there is no
   in-app override, by design.
4. If `auth.mail.receipt_failed` is firing repeatedly, the message is still
   sent (the user has their email) but bounce/complaint correlation for that
   `providerMessageId` will be delayed — reconcile using the ID in the log,
   never the address.

### Invalid origin / RP configuration

**Symptom:** every passkey ceremony or state-changing auth POST fails with a
generic `403`/rejected ceremony after a deploy, config change, or new
frontend origin.

1. Confirm `PUBLIC_APP_URL` is the exact HTTPS origin browsers use. Passkey
   `rpID`/`origin` and the same-origin gate both derive from it
   (`apps/web/src/features/auth/server.ts`); a mismatch between the
   configured origin and the browser's actual origin rejects every
   ceremony and state-changing POST, never partially.
2. State-changing calls to the mounted router (`/api/auth/*`) that lack a
   matching `Origin` header answer `403` before reaching Better Auth
   (`apps/web/src/features/auth/handlers.test.ts`, "rejects state-changing
   calls from foreign or absent origins"); `/auth/confirm` and
   `/auth/confirm-email` enforce the same boundary independently
   (`confirm.test.ts`, `confirm-email.test.ts`). A wave of these at once
   after a deploy is the signature of a `PUBLIC_APP_URL` drift, not an
   attack.
3. A wrong-origin WebAuthn ceremony response is rejected with no credential
   stored (`apps/web/integration/auth-passkey-ceremony.integration.ts`, "a
   wrong origin in the ceremony response is rejected") — if this fires for
   every real user (not just adversarial tests), the deployed `rpID`
   (derived from `PUBLIC_APP_URL`'s hostname) no longer matches the
   hostname users are actually on. Changing production RP identity is a
   separately reviewed compatibility decision (spec, "Runtime and package
   boundaries"); never patch around it by relaxing the origin check.

### Database or Redis storage failure

**Symptom:** auth requests answer `503`/`500` in bursts, or rate limiting
appears to stop working (every request allowed, or every request denied).

1. Filter for `event:"db.query.failed"` (Postgres) or
   `event:"redis.command.failed"` — both carry only the safe operation name,
   never SQL text, bound parameters, or the raw driver exception
   (`apps/web/integration/auth-database-failures.integration.ts`, "pool
   lifecycle closes and the app failure boundary reports without SQL
   material"; `apps/web/src/features/auth/rate-limit.ts`'s limiter outage
   path, `apps/web/integration/auth-rate-limit.integration.ts`, "a Redis
   outage answers a safe 503 for every request and never counts locally").
2. A Redis outage fails every rate-gated auth request closed (`503` +
   `Retry-After: 5`), logged as `auth.rate_limit.unavailable`; it never
   silently allows unlimited traffic and never double-counts once Redis
   returns — there is no local fallback counter to reconcile.
3. A Postgres outage while issuing or redeeming a magic link answers a safe
   retryable error with no SQL, parameters, or address in the response body
   or logs (`apps/web/integration/auth-failure.integration.ts`, "a database
   outage while issuing a link" / "...while redeeming").
4. Recovery is passive: once the dependency is reachable again, the next
   request succeeds normally — there is no cache to invalidate or counter to
   reset by hand. If `auth.rate_limit.unavailable` or `db.query.failed`
   continues after the dependency reports healthy, check connection pool
   exhaustion (`packages/db`'s configured `maxConnections`) before assuming
   the dependency itself is still down.

### Session invalidation / revocation failure

**Symptom:** a user reports a device or browser they signed out (or an
account-security action that should revoke sessions) is still authenticated,
or the reverse — a session they expect to still work is unexpectedly signed
out.

1. Confirm the specific milestone fired: `auth.session.revoked` (one named
   other session), `auth.session.revoked_all` (every other session, from
   "sign out of all other sessions" or an email-change completion), or
   `auth.email_change.verified` (which revokes every other session as part
   of completing the change) —
   (`apps/web/integration/auth-session-management.integration.ts`,
   "revoking a specific session and revoking every other session each emit
   their own lifecycle event"; `apps/web/integration/auth-email-change.integration.ts`,
   "completing the change notifies the old address and revokes other
   sessions"). No event means the revocation request never reached the
   server — check for a `403` from the same-origin/fresh-session gate first.
2. Session reads never cache (`cookieCache: { enabled: false }`), so a
   revoked session is denied on the **very next** server check, not after a
   TTL (`apps/web/integration/auth-sign-in-journey.integration.ts`, "a
   revoked session is anonymous on the very next check"). If a revoked
   session still authenticates, the request is not reaching the mounted
   session read at all (a stale CDN/edge cache in front of the app, not an
   application bug) — this composition never caches session decisions
   itself.
3. A sensitive session/credential change (revoke, passkey removal, email
   change) that fails with `401`/`403` on an otherwise-valid cookie is the
   fresh-session gate: these require re-authentication within the last hour
   (`apps/web/integration/auth-session-management.integration.ts`, "a stale
   session is refused for revoking..."). Direct the user to sign in again
   (magic link or passkey); this is expected behavior, not a fault.
4. If the session store itself is unreachable, guarded pages and the
   username claim answer `503` (never a silent sign-out), logged as
   `auth.session.unavailable` — treat it as the database/Redis runbook
   above, not as a revocation bug.

### Storage or rate limiter unavailable

**Symptom:** the `storage_unavailable` or `limiter_unavailable` alert fires
(`apps/web/src/server/alert-state.test.ts`, "storage unavailable for
exactly the threshold fires" / "limiter unavailable for 2+ minutes fires
limiter_unavailable").

1. This is the same underlying condition as "Database or Redis storage
   failure" above (`auth.session.unavailable`/`auth.rate_limit.unavailable`);
   follow that runbook to diagnose the outage itself.
2. The alert fires only once the condition has held for 2+ minutes
   (`apps/web/src/server/alert-recorder.test.ts`, "marks storage unavailable
   on auth.session.unavailable" proves the marker is written on the first
   occurrence with a 3-minute bridging TTL) — a single transient failure
   does not page anyone.
3. No manual reset is needed: the marker expires on its own 3 minutes after
   the last occurrence, so the alert clears passively once the dependency
   recovers and stays recovered.

### Delivery provider failing repeatedly

**Symptom:** the `delivery_failures` alert fires
(`apps/web/src/server/alert-state.test.ts`, "3 consecutive delivery
failures fire; 2 does not").

1. Follow "Mail delivery is failing" above to diagnose Resend itself; this
   alert is that same condition crossing 3 consecutive `auth.mail.failed`
   events with no intervening successful send
   (`apps/web/src/server/alert-recorder.test.ts`, "increments consecutive
   mail failures on auth.mail.failed, resets on auth.mail.sent").
2. The counter resets to zero on the next successful send; no manual reset
   is needed once Resend recovers.

### Auth 5xx error rate elevated

**Symptom:** the `auth_5xx_rate` alert fires
(`apps/web/src/server/alert-state.test.ts`, "auth 5xx above 1% with at
least 100 requests fires; below either threshold does not").

1. Filter the event stream for `event:"http.request.completed"` or
   `event:"http.request.failed"` with `operation` starting `auth.` and
   `status >= 500` over the alert's window; both events carry `status`
   (`apps/web/src/server/http.test.ts`, "log the response status alongside
   the error code (AUTH-7.7 5xx-rate alert input)" proves `http.request.failed`
   carries it too, not only the completed path).
2. A burst of `auth.request` 503s usually means the storage/limiter runbook
   above; a burst of `INTERNAL`/`500`s with no matching `db.query.failed`
   or `redis.command.failed` means an application defect, not an outage —
   escalate rather than wait for recovery.
3. The rate is computed over a trailing 10-minute window and requires at
   least 100 requests in that window, so a low-traffic burst of failures
   (fewer than 100 total auth requests) does not page anyone even at 100%
   failure — check `GET /api/ops/metrics`'s `auth_http_requests_total` for
   the actual volume before assuming the alert under- or over-fired.

### Retention cleanup missed

**Symptom:** the `cleanup_missed` alert fires
(`apps/web/src/server/alert-state.test.ts`, "a retention sweep silent for
2+ hours, or never successful, fires cleanup_missed").

1. Filter the event stream for `event:"retention.sweep.failed"` — see
   "Retention of verification records" and "Retention of sessions" above
   for the manual `psql` fallback if a backlog needs draining sooner than
   the next hourly run.
2. If no `retention.sweep.failed` events appear either, the sweep is not
   running at all — check that the app process is up (`GET
/api/health/ready`) and that it has completed at least one boot since
   the last deploy (`retention-sweep.ts`'s `runOnStart` sweeps once at
   start-up, before the hourly schedule).
3. The marker this alert reads (`alert-retention-last-success`) is written
   only on `retention.sweep.completed`, so a sweep that runs but never
   fully succeeds keeps this alert firing even while individual batches
   make progress — that is intentional (AUTH-7.7's "cleanup missed" names
   the failure to _complete_, not the failure to _attempt_).
