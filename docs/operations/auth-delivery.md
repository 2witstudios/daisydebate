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
   Better Auth with `AUTH_TRUSTED_PROXIES`. Set only headers your own proxy
   overwrites.

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
- Webhooks that fail signature or tolerance answer `400`; events for a message
  recorded moments earlier answer `503` so the provider retries; events for
  unknown old messages are acknowledged and dropped.
