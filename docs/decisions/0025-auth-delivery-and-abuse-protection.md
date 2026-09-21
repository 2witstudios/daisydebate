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
  nothing is ever sent automatically. Tokens are stored hashed
  (`storeToken: 'hashed'`) with a five-minute expiry; Better Auth's atomic
  consume keeps redemption single-use.
- **Rate limiting.** The ADR 0020 gate (`createRateLimitGate`, a Better Auth
  `hooks.before`; Better Auth's built-in limiter stays disabled) hands each
  bucket and its rule to the injected limiter. The Redis limiter runs one Lua
  `EVAL` in `@daisy/redis` (fixed window: INCR, arm expiry, decide). Keys are
  `<namespace>:v1:rl:<sha3-256 hex>`: identifiers are hashed and every key
  expires. Defaults are 100/60 s; magic-link requests are 3/60 s per client and
  3/60 s per recipient. A limiter failure fails closed as a safe `503` (the
  route boundary adds `Retry-After: 5`); there is no process-local fallback and
  no allow-on-error. `429` carries `Retry-After`.
- **Trusted client identity.** The composition trusts exactly one header
  (`clientIp: { trustedHeaders: ['x-daisy-client-ip'] }`), the internal
  `x-daisy-client-ip` header. The production ingress (`start.ts`) replaces any
  caller-supplied value with the socket peer, or — only when the peer is in
  `AUTH_TRUSTED_PROXIES` — the first untrusted hop from the right of
  `X-Forwarded-For`. Absent an identity the request shares one fail-safe bucket
  per path rather than escaping the limit.
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

Why: each control closes a distinct failure the spec names (link prefetch,
counter races and process-local limits, spoofed forwarding headers, provider
outages and bounce loops) using existing PostgreSQL and Redis only.

Tradeoffs: a fixed window admits up to twice the limit across a window
boundary; suppression is keyed to `BETTER_AUTH_SECRET`, so rotating it forgets
suppressions (acceptable: the provider re-suppresses on the next hard bounce);
the strict `Origin` requirement means non-browser API clients are unsupported.
