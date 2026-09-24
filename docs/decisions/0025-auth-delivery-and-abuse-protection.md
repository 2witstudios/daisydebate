# 0025: authentication delivery and abuse protection

Status: accepted.

Stage 3 of passwordless authentication mounts Better Auth at `/api/auth/*` and
adds the delivery and abuse controls ADR 0020 requires before activation.

- **Scanner-safe links.** Emailed links open `/auth/confirm?token=…`, a
  server-rendered, no-store, asset-free page. `GET`/`HEAD` never redeem. Only
  an explicit same-origin `POST` forwards the token to Better Auth's
  `/magic-link/verify` through the mounted router (rate limits and origin
  checks apply), copies every `Set-Cookie`, and redirects `303` to a
  token-free, validated local path (default `/lobby`, new users
  `/onboarding/username`). Expired or consumed links land on
  `/auth/confirm?error=INVALID_TOKEN`, which offers a user-initiated resend;
  nothing is ever sent automatically. Email-change links open
  `/auth/confirm-email?token=…` under the same rules. Every token follows
  the model below.
- **Emailed-link token model (ISSUE-2; owner decision, 2026-09-23).** This
  is the standard for every emailed link: sign-in, recovery, email change
  and every future type, such as invites. The link carries only an opaque
  token: 32 bytes from the OS CSPRNG, base64url (256 bits). No claims ride
  in the link. The server stores only `<purpose>:<SHA3-256 hex of the
token>` as the `verification.identifier`. The subject (the email for
  sign-in; the account, current address and new address for an email
  change) lives in `value`, with the expiry in `expires_at` (five minutes).
  The purpose prefix scopes the lookup, so a token redeems only in the
  flow it was issued for. Redemption goes through Better Auth's atomic
  `consumeVerificationValue`: one transaction per token under a consume
  lock. Exactly one caller wins, a lost race sees nothing, and an expired
  row is deleted without being honoured. Tokens are redeemed only by the
  same-origin `POST` confirm pages. The mounted router answers `404` to a
  direct request for either redemption endpoint (`/magic-link/verify`,
  `/email-change/verify`; ISSUE-3). Tokens are not bound to a device, so a
  link opened in another browser still works. Implementation:
  `apps/web/src/features/auth/emailed-link-token.ts`. Magic links use it
  through the plugin's `generateToken` and a `custom-hasher` `storeToken`.
  Better Auth's `'hashed'` option would be SHA-256. The recovery-email
  change (AUTH-5.6) is Daisy's `daisy-email-change` plugin
  (`email-change.ts`). Better Auth 1.7.5's own change-email flow signs a
  stateless JWT holding the addresses and the step, which can be neither
  stored nor revoked. The plugin replaces the core `changeEmail` endpoint
  under the same key and path, so the fresh-session gate, rate limit and
  lifecycle event keyed on `/change-email` still apply. It redeems both
  hops (old-inbox approval, then new-inbox verification) at
  `/email-change/verify`. It refuses a claim whose account no longer holds
  the old address, or whose new address was taken in the meantime.
  `/verify-email` and `/send-verification-email` are disabled. The only
  other value an emailed link carries is the sign-in link's requested
  local destination, which grants nothing: it is re-validated as a local
  path when the link is built and again on redemption. Email-change links
  carry no destination at all.
- **Rate limiting.** The ADR 0020 gate (`createRateLimitGate`, a Better Auth
  `hooks.before`; Better Auth's built-in limiter stays disabled) hands each
  bucket and its rule to the injected limiter. The Redis limiter runs one Lua
  `EVAL` in `@daisy/redis` (fixed window: INCR, arm expiry, decide). Keys are
  `<namespace>:v1:rl:<sha3-256 hex>`: identifiers are hashed and every key
  expires. Defaults are 100/60 s. Magic-link requests carry one client bucket
  (3/60 s), three per-recipient windows (3/60 s, 10/hour, 20/day — a single
  60 s window alone would still admit thousands of emails a day to one victim
  from rotating clients), and two whole-application ceilings independent of
  any client or recipient (120/60 s, 3,000/day — protects Resend quota, cost
  and sending-domain reputation from many recipients each staying under their
  own ceiling). A limiter failure fails closed as a safe `503` (the route
  boundary adds `Retry-After: 5`); there is no process-local fallback and no
  allow-on-error. `429` carries `Retry-After`. The gate consumes a request's
  buckets in order (client, recipients, global) and every consume counts,
  admitted or not, so a request denied by a later bucket has already spent
  the earlier buckets' budget. That is accepted: a caller who keeps retrying
  while the global ceiling is saturated also exhausts their own client and
  recipient allowance, but nothing is admitted wrongly, and spending nothing
  on denial would need one atomic multi-key script across every bucket.
  Integration tests prove the recipient hour and day ceilings and both
  global ceilings against real Redis.
- **Trusted client identity — one resolver.** Better Auth's `advanced.ipAddress`
  is fixed to `{ ipAddressHeaders: [CLIENT_IP_HEADER] }`, the internal
  `x-daisy-client-ip` header, with no deployment-configurable header list and
  no `trustedProxies` option of its own — there is exactly one place client
  identity is resolved. The production ingress (`start.ts`) replaces any
  caller-supplied value with the socket peer, or — only when the peer is in
  `AUTH_TRUSTED_PROXIES` — the first untrusted hop from the right of
  `X-Forwarded-For`. Beside it the ingress stamps `x-daisy-client-id-hash`, a
  SHA3-256 of the identity keyed by a subkey of `BETTER_AUTH_SECRET` (label
  `client-id-hash`). Request logs carry only that keyed hash: an unkeyed
  hash of an IPv4 address is reversed by hashing all 2^32 of them.
  `next dev` runs without that ingress, so a dev-mode request carries no
  such header and shares one "unknown" bucket per path,
  same as any other missing identity: a fail-safe bucket, never an escaped
  limit.
- **Origin rule.** State-changing `/api/auth/*` calls must carry the exact
  application `Origin`, in addition to Better Auth's own checks (which only
  engage for cookie-bearing requests). Callback destinations are local paths;
  external, protocol-relative and encoded forms are refused.
- **Mail.** Delivery goes through the injected sender seam. The Resend
  transport uses a ten-second total deadline, at most one retry of a transient
  failure under one idempotency key, and exposes only a generic retryable `503`
  (`EMAIL_DELIVERY_FAILED`). Open/click tracking is a Resend domain setting and
  must be disabled on the sending domain (human prerequisite AUTH-1.3).
- **Provider events.** `/api/webhooks/resend` verifies the raw body with the
  official Resend verifier (five-minute tolerance), deduplicates by event ID in
  PostgreSQL, and records only message/event IDs and a monotonic status rank.
  Recipients appear solely as a keyed SHA3-256 hash. Permanent bounces and
  complaints add a suppression that stops automatic resends with safe guidance
  (passkey or another address); events never create, verify or alter accounts.
- **Signature verification.** Webhook signatures are verified by the vendor
  (`resend.webhooks.verify`, standardwebhooks: HMAC-SHA256 with
  `timingSafeEqual`). This is a deliberate exception to the repo's SHA3-256
  comparison preference: Resend/Svix dictate the scheme, and a hand-rolled
  verifier would be worse.
- **Disclosure tradeoff.** A suppressed (hard-bounced or complained) address
  answers a distinct `422 EMAIL_UNDELIVERABLE`, revealing to any caller that
  the address bounced (not that an account exists); accepted for safe user
  guidance.
- **Verification retention (AUTH-7.5a).** Better Auth's `verification.value`
  holds the plaintext email JSON and Better Auth does not purge expired rows,
  so the server purges them itself: an in-process job (at start-up, then
  hourly) deletes rows expired more than 24 hours ago, at most 20 batches of
  500 per run
  (`DELETE … WHERE id IN (SELECT … LIMIT … FOR UPDATE SKIP LOCKED)` on the
  existing expiry index; no migration, no new service). Every instance runs it;
  concurrent runs split work without double deletes and live rows can never
  match the predicate. Shutdown stops the job between batches and waits for
  it before the pool closes. Since ISSUE-8 AC5 this job is one target of the
  web server's single retention sweep
  (`apps/web/src/server/retention-sweep.ts`), which also prunes
  `email_delivery_event` 30 days after receipt and `email_delivery` 30 days
  after its last status change (`email_suppression` is never pruned) and
  logs `retention.sweep.completed` (counts only) or `retention.sweep.failed`
  (stable code) per target. Session retention remains with AUTH-7.5.

Why: each control closes a distinct failure the spec names (link prefetch,
counter races and process-local limits, spoofed forwarding headers, provider
outages and bounce loops) using existing PostgreSQL and Redis only.

Tradeoffs: a fixed window admits up to twice the limit across a window
boundary; suppression is keyed to `BETTER_AUTH_SECRET`, so rotating it forgets
suppressions (acceptable: the provider re-suppresses on the next hard bounce);
the strict `Origin` requirement means non-browser API clients are unsupported.
