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
- **Residual risk: sign-up at a released address (ISSUE-99, ISSUE-110;
  owner decision, 2026-09-24).** Completing an email change deletes every
  outstanding sign-in link to the old address in the same transaction that
  moves the account (`completeEmailChange`). That delete sees only the links
  whose stored rows committed before its statement started. Such a link,
  redeemed after the change completes, creates no session and no account;
  the ISSUE-99 integration test proves it through the real confirm pages.
  Two interleavings around the instant the change commits remain open, and
  each can sign up a new, empty account at the released old address:
  - A link _requested_ while the change is committing: its row commits
    after the delete statement started but before the change commits, so
    the delete does not see it and it survives. Redeemed at any later time
    within its five-minute lifetime, it finds no account at the old address
    and signs one up (reproduced by the PR #95 second-pass review).
  - A link _redeemed_ in that instant: Better Auth consumes a sign-in token
    before it looks the address up, so the lookup can land after the
    address switch, find the address already released and sign up there
    (ISSUE-109).

  The owner accepted the concurrent released-address sign-up as residual
  risk. That the acceptance also covers a link requested in the committing
  instant is recorded as DEC-5, open until the owner confirms or overrules
  it. It is not a takeover: the changed account keeps its new address,
  sessions and data. And whoever holds the old inbox could sign up at that
  address anyway by requesting a fresh link.

- **No session survives an email change it straddles (ISSUE-103).** A
  redemption whose lookup found the account _before_ the address switch is
  not in that window. Better Auth creates its session in a later statement,
  so the change's revoke-all could run first, and the session would then
  outlive the change on an account that no longer holds the address the
  link proved. After the session commits, an `after` hook on
  `/magic-link/verify` (`sign-in-address-guard.ts`) runs one statement
  (`revokeSessionUnlessAddressHeld`) that deletes it unless the account
  still holds that address, and answers as for a spent link. A change
  whose switch committed first is visible to that statement. One that
  commits later is followed by its revoke-all, which the insert's user-row
  lock orders after the session (ISSUE-22). So either the guard or the
  revoke-all removes it.
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
  own ceiling). The whole-application ceilings meter only links to addresses
  with no account, that is sign-up links (ISSUE-54, amended 2026-09-24); the
  gate looks the address up only after the client and recipient buckets have
  admitted the request. A limiter failure fails closed as a safe `503` (the route
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
- **Global-ceiling sign-in denial (ISSUE-54, amended 2026-09-24).** Before
  this amendment the global ceilings counted every magic-link request, so a
  single actor could deny magic-link sign-in to the whole application. At
  the client rate (3 a minute per address), rotating IPv6 /128 addresses
  made every request a new client, and plus-addressed recipients
  (`victim+1@…`, `victim+2@…`) made every request a new recipient, so no
  per-client or per-recipient bucket ever stopped it and 3,000 requests
  spent the day's allowance for everyone. Accepted mitigation: sign-in to
  an existing account never counts against the global ceilings and is never
  denied by them. That mail stays bounded per account by the recipient
  ceilings (20 a day per account), so its total is bounded by the account
  base, not by any attacker. Plus-addressed variants are distinct
  addresses with no account, so they stay metered. Residual risks, accepted:
  one actor can still drain the global ceilings with new addresses, which
  delays new sign-ups (they answer `429` until the window resets) but denies
  no sign-in, and passkey sign-in never sends mail at all. While a global
  ceiling is saturated, a `429` for an address and a `200` for another tells
  the caller which one has an account; probing costs the caller its own
  client and recipient allowance and mails each real account holder a
  sign-in link, which they can see.
- **Suppression covers every auth mail (ISSUE-54).** Every auth email
  (sign-in links, email-change approval and confirmation, passkey
  added/removed notices) goes through the one delivery path
  (`createAuthServer`'s `sendMail`), which checks the suppression ledger
  before anything reaches the transport. A suppressed recipient is logged
  as `auth.mail.suppressed` and nothing is sent. A mail the flow cannot
  proceed without (the sign-in link, the email-change approval to the
  current address, the confirmation to the new one) answers the same `422
EMAIL_UNDELIVERABLE` the sign-in gate does, except the email-change
  approval: the address on file cannot receive it, so a different new
  address would not help, and it answers `422 CURRENT_EMAIL_UNDELIVERABLE`
  (ISSUE-113). Both codes are defined once, in `undeliverable-codes.ts`. A passkey notice is
  best-effort, so the change it reports still completes. A ledger outage
  fails the send: required mail fails closed with the retryable `503`, and
  a notice logs `auth.passkey.notification_failed`. Two requests also check
  the ledger before any token is created or mail sent, through one shared
  check (`suppression-check.ts`): the sign-in gate, so a suppressed address
  leaves no stored link, and `/change-email` for both the new address
  (ISSUE-104) and the address on file (ISSUE-113). The email change runs
  both checks before it looks the new address up, so each `422` answers the
  same whether or not the new address has an account (ISSUE-117). An
  address suppressed after the request is still refused at the approval
  hop, where the confirm page says the new address cannot receive email and
  the person starts again with another address.
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
  guidance. `CURRENT_EMAIL_UNDELIVERABLE` tells a signed-in account holder
  only about their own address on file.
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
