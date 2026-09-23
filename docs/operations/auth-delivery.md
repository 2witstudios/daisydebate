# Authentication delivery and abuse protection

Operational contract for `/api/auth/*`, `/auth/confirm` and
`/api/webhooks/resend` (ADR 0025). Full incident runbooks belong to the
observability leaf (AUTH-6.4); this page holds the facts operators need to
deploy and to reason about failures.

## Required configuration (production refuses to start without it)

| Variable                | Purpose                                                        |
| ----------------------- | -------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`    | 64 characters from 32 random bytes; also keys recipient hashes |
| `PUBLIC_APP_URL`        | HTTPS canonical origin; derives the passkey RP ID and origin   |
| `RESEND_API_KEY`        | Resend send credential (owner-provisioned; never in PageSpace) |
| `AUTH_EMAIL_FROM`       | Verified sender mailbox                                        |
| `RESEND_WEBHOOK_SECRET` | `whsec_…` signing secret of the Resend webhook                 |
| `AUTH_TRUSTED_PROXIES`  | Optional IP/CIDR list of deployment ingress hops (see below)   |

`apps/web/src/server/start.ts` validates these at boot and reports field names
only. Live delivery additionally needs the human prerequisite AUTH-1.3: a
verified Resend domain (SPF, DKIM, initial DMARC monitoring policy) with
**open and click tracking disabled** — tracking is a domain-level Resend
setting the message API cannot override — and a webhook pointing at
`https://<origin>/api/webhooks/resend` subscribed to `email.sent`,
`email.delivered`, `email.delivery_delayed`, `email.failed`, `email.bounced`,
`email.complained`.

## Client identity and ingress assumptions

Rate limits bucket by client. The composition believes, in order:

1. `x-daisy-client-ip`, stamped by our own ingress (`start.ts`) on every
   request, replacing any caller value. It is the socket peer, or — only when
   the peer is in `AUTH_TRUSTED_PROXIES` — the first address from the **right**
   of `X-Forwarded-For` that is not itself a trusted hop, so an
   attacker-prepended left-most value never selects the bucket.
2. Any header named in `AUTH_TRUSTED_IP_HEADERS` (default none), resolved by
   Better Auth. Consulted only when no stamped identity exists (runtimes that
   do not stamp, such as `next dev`); in production the stamp is always
   present, so this setting has no effect there. Set only headers your own
   proxy overwrites.

In production, `AUTH_TRUSTED_PROXIES` (with `X-Forwarded-For`) is the mechanism
for reading the real client behind a proxy. A proxy not listed there makes all
its users share one rate-limit bucket.

Configure exactly the hops you operate; an over-broad range re-opens spoofing.
Under `next dev` there is no ingress stamp and requests share the loopback
bucket. Verify with the spoofing suite (`auth-ingress.integration.ts`) adapted
to your topology before release.

## Limits and outage behaviour

| Scope                               | Limit      | On exceed                |
| ----------------------------------- | ---------- | ------------------------ |
| Any auth route, per client and path | 100 / 60 s | `429` + `Retry-After`    |
| Magic-link request, per client      | 3 / 60 s   | `429` + `Retry-After`    |
| Magic-link request, per recipient   | 3 / 60 s   | `429` + `Retry-After`    |
| Redis unavailable                   | —          | `503` + `Retry-After: 5` |

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
live under `<REDIS_NAMESPACE>:v1:rl:<sha3-256>` and expire within 60 seconds.

## Mail failure and bounces

- Provider failure or timeout: the requester sees `503 EMAIL_DELIVERY_FAILED`
  and may retry; the unsent token is never delivered and expires unused.
- Hard bounce or complaint: the address is suppressed (`email_suppression`,
  keyed hash only). Requests for it answer `422 EMAIL_UNDELIVERABLE` with
  guidance to use a passkey or another address; existing sessions and passkeys
  are untouched. Clearing a suppression is an explicit operator action on that
  table and should follow confirmation that the mailbox is fixed.
- Diagnostics: `email_delivery` (message ID, status rank, recipient hash) and
  `email_delivery_event` (event ID dedupe). Neither holds an address or a
  payload. Event rows are retained 30 days (AUTH-7.5 owns the cleanup job).
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

Magic-link requests write a `verification` row (hashed token identifier; the
requested email is inside `value`). Redeeming deletes the row; unredeemed rows
are purged by a job in each server process (once at start-up, then hourly),
only once expired for more than 24 hours, at most 20 batches of 500 per run (a
bigger backlog drains over later runs). Runs are idempotent and safe across
instances (`SKIP LOCKED`). On shutdown the job stops between batches and the
server waits for it before closing the database, so a normal restart never
raises a false `auth.cleanup.failed`. Events: `auth.cleanup.completed`
(`deleted`, `batches`) and `auth.cleanup.failed` (alert on this one; a failing
run is retried next hour).

No manual action is needed. To purge sooner, restart a server instance (it
cleans once at start-up) or run one bounded batch in `psql`, repeating until it
reports `DELETE 0`:

```sql
DELETE FROM verification WHERE id IN (
  SELECT id FROM verification
  WHERE expires_at < now() - interval '24 hours'
  ORDER BY expires_at LIMIT 500 FOR UPDATE SKIP LOCKED);
```

## Incident runbooks (AUTH-6.4)

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
