# Deploy: Fly.io staging (AUTH-7.0)

Scale-to-zero staging deployment of `apps/web` on Fly.io, org `daisy-debate`.
`fly.toml` (repo root) and `apps/web/Dockerfile` define the app; this is the
operator runbook for the account-side steps a Builder agent cannot take
(creating billing-adjacent resources, setting secrets, deploying). Every
step's flag names were verified against the installed `flyctl` (v0.4.105,
`flyctl version`) and https://fly.io/docs/reference/configuration/ /
https://fly.io/docs/flyctl/ as of 2026-09-22 — re-check flag names if the
installed flyctl has since changed.

No custom domain: the app is reachable at `https://<app>.fly.dev` only
(owner decision). Postgres and Redis are external free tiers (Neon,
Upstash), reached through the existing `DATABASE_URL` / `REDIS_URL`
contract — no Fly Postgres, no new client libraries.

## Idle cost (per the owner's spend constraint)

| Piece | Idle cost | Source |
| --- | --- | --- |
| Fly machine (shared-cpu-1x, 512mb), stopped (`min_machines_running = 0`) | $0 compute. Only rootfs storage is billed while stopped: $0.15 per 1GB for 30 days (this image is ~1.2GB, so a fraction of $0.15/mo when stopped) | https://fly.io/docs/about/pricing/ |
| Fly machine, running | ~$0.00000156/s ≈ **$4.04/month if left running continuously** (region-dependent; staging should spend almost none of this since `auto_stop_machines` suspends it between requests) | https://fly.io/docs/about/pricing/ |
| Neon Postgres (Free plan) | $0/month. 0.5GB storage, 100 CU-hours/month compute, autoscale up to 2 CU, 5GB egress included, compute auto-suspends after 5 minutes idle (no CU-hours accrue while suspended) | https://neon.com/pricing |
| Upstash Redis (Free plan) | $0/month. 256MB storage, 500K commands/month, 10GB bandwidth/month, 1 free database | https://upstash.com/pricing |
| Resend | Free tier covers low-volume staging email + webhooks; no idle cost beyond the account itself | https://resend.com/pricing |

Net: this deployment costs $0/month at rest, and only the fractional-cent
rootfs storage charge plus any actual staging traffic while awake.

## Client identity on Fly (verify on first deploy)

`apps/web/src/server/ingress.ts` stamps `x-daisy-client-ip` from the raw
socket peer unless that peer is a configured trusted proxy, in which case it
walks `X-Forwarded-For` from the right instead (see
`apps/web/src/features/auth/client-ip.ts`). Fly's edge (fly-proxy)
terminates the client's TLS connection and forwards to the app's machine
over Fly's private 6PN network
(https://fly.io/docs/networking/private-networking/, prefix `fdaa::/8`), so
the socket peer the app sees is fly-proxy's 6PN address, not the caller's —
`AUTH_TRUSTED_PROXIES` must include that range or every request collapses to
one shared rate-limit identity. Fly documents that fly-proxy sets both
`Fly-Client-IP` and `X-Forwarded-For` "including the address of the client
that originated the request"
(https://fly.io/docs/networking/request-headers/); this app only reads
`X-Forwarded-For` (hardcoded in `client-ip.ts`), so `Fly-Client-IP` is not
used. `fly.toml` sets `AUTH_TRUSTED_PROXIES = "fdaa::/8"` — Fly does not
document a narrower CIDR specific to fly-proxy's own address, so the whole
6PN prefix is trusted (only Fly's own infrastructure can originate traffic
on that private network; the internet cannot reach a Fly machine's 6PN
interface directly).

**This is inferred from Fly's documented header contract, not measured**:
Fly's docs do not state the literal TCP peer address an app process sees.
Confirm the real chain after first deploy:

```
fly ssh console -a <app>
# inside the machine: replay a real inbound request path, e.g.
curl -s https://<app>.fly.dev/api/health/live -H "X-Forwarded-For: 203.0.113.9"
# then check structured logs for the stamped identity used on that request
fly logs -a <app> --no-tail | grep 'x-daisy-client-ip\|client'
```

If the resolved client address is not the real caller, widen or correct
`AUTH_TRUSTED_PROXIES` in `fly.toml` and redeploy — do not leave it unset,
since that degrades every user to one shared rate-limit bucket per auth
path (safe, but defeats per-client rate limiting).

`AUTH_TRUSTED_IP_HEADERS` is **not** set: `apps/web/src/lib/auth.ts` always
puts `CLIENT_IP_HEADER` (`x-daisy-client-ip`, stamped by the ingress above)
first in Better Auth's trusted header list; `AUTH_TRUSTED_IP_HEADERS` only
matters for non-stamping runtimes such as `next dev`, which staging never
runs.

## Scale-to-zero consequences

- **Hourly verification purge (AUTH-7.5a) stops while suspended.**
  `apps/web/src/server/start.ts` starts `startMaintenance` (hourly
  `setInterval`, `runOnStart: true`) in-process. A suspended machine runs no
  process, so no interval fires; expired verification rows accumulate while
  stopped and are purged immediately on the next wake (`runOnStart: true`
  runs the purge as soon as the process starts again). This is inherent to
  scale-to-zero, not a defect — do not add a Fly-side cron to work around it
  without an explicit decision to do so.
- **Cold start, measured locally (not on Fly):** `docker build` of the
  production image takes ~30-60s depending on cache; a fresh container
  (`docker run`, production config, against the local `*_test` stack)
  answers `/api/health/ready` with `200` within ~4s of `docker run` — see
  the Handoff page for the exact timed run. This is a **local proxy**, not a
  measurement of Fly's actual cold start (Firecracker VM boot + volume
  attach + fly-proxy health-check grace period all add time Fly does not
  publish a fixed number for). Time the real cold start after first deploy:
  ```
  fly machine list -a <app> --json   # confirm 0 machines running (stopped)
  time curl -s -o /dev/null -w '%{http_code}\n' https://<app>.fly.dev/api/health/ready
  ```
  `http_service.checks` grace_period is 10s and interval 15s in `fly.toml`;
  if the real cold start regularly exceeds that, raise `grace_period`.
- **Resend webhook delivery to a stopped machine.** Resend's webhooks are
  Svix-powered and retry non-2xx/unreachable deliveries on a fixed schedule
  — 5 seconds, 5 minutes, 30 minutes, 2 hours, 5 hours, 10 hours after the
  original attempt (https://resend.com/docs/dashboard/webhooks/introduction),
  roughly an 18-hour total window. `auto_start_machines = true` wakes the
  machine on any incoming HTTP request, including a webhook POST, so the
  first attempt (or the 5-second retry) should reach a running machine well
  within that window; a webhook is not lost to scale-to-zero unless the
  machine also fails its readiness check after waking.
- **Passkey RP hostname stability.** `apps/web/src/features/auth/server.ts`
  derives the WebAuthn RP ID as `new URL(config.PUBLIC_APP_URL).hostname`.
  `PUBLIC_APP_URL` is fixed at `https://<app>.fly.dev` (no custom domain),
  and that hostname never changes across stop/start cycles — only the
  underlying machine and its 6PN address change, neither of which RP ID
  depends on. Passkeys registered against this staging app stay valid
  across every scale-to-zero cycle.

## 1. Create the app

```
fly auth login                       # once per operator machine
fly apps create daisy-debate-staging --org daisy-debate
```

Verify: `fly status -a daisy-debate-staging` shows the app with no machines
yet (this only reserves the name; `fly.toml`'s `app` field must match).

## 2. Provision Neon (Postgres)

1. Create a Neon project (free tier) in the Neon console; create a database
   for staging.
2. Copy the pooled connection string Neon gives you (`postgres://...`).
   Production forbids the local-development password sentinel
   (`packages/config/src/index.ts` rejects `local-development-only`), so any
   real Neon credential is fine as-is.

Verify: `psql "$NEON_DATABASE_URL" -c 'select 1'` returns `1`.

## 3. Provision Upstash (Redis)

1. Create an Upstash Redis database (free tier, TLS enabled).
2. Copy the `rediss://` connection string (TLS) Upstash gives you —
   `packages/config/src/index.ts` requires `redis:` or `rediss:`.

Verify: `redis-cli -u "$UPSTASH_REDIS_URL" ping` returns `PONG`.

## 4. Create the Resend webhook (before first deploy)

The signing secret only exists once the webhook is created, and production
refuses to boot without `RESEND_WEBHOOK_SECRET` — create the webhook first,
even though the app is not live yet; Resend will queue/retry failed
deliveries per the schedule above once the app exists.

1. In the Resend dashboard, create a webhook targeting
   `https://daisy-debate-staging.fly.dev/api/webhooks/resend`.
2. Subscribe to: `email.sent`, `delivery_delayed`, `delivered`, `failed`,
   `bounced`, `complained`.
3. Copy the signing secret (`whsec_...`).

Verify: the Resend dashboard shows the webhook as created with those six
events checked (delivery will show as failing until step 7 — that's
expected, nothing is listening yet).

## 5. Set secrets

```
fly secrets set -a daisy-debate-staging \
  DATABASE_URL="$NEON_DATABASE_URL" \
  REDIS_URL="$UPSTASH_REDIS_URL" \
  BETTER_AUTH_SECRET="$(bun -e 'console.log(crypto.getRandomValues(new Uint8Array(32)).reduce((s,b)=>s+b.toString(16).padStart(2,"0"),""))')" \
  RESEND_API_KEY="re_..." \
  AUTH_EMAIL_FROM="Daisy <no-reply@yourdomain.example>" \
  RESEND_WEBHOOK_SECRET="whsec_..."
```

`APP_VERSION` and `GIT_COMMIT` are non-secret and set per-release, not as
persistent secrets — pass them as build args or set them via
`fly deploy --env` at deploy time (step 6); production refuses to boot with
`APP_VERSION`/`GIT_COMMIT` at their `development`/`unknown` defaults
(`packages/config/src/index.ts`).

Verify: `fly secrets list -a daisy-debate-staging` shows all six names (not
values — Fly never displays a set secret's value back).

## 6. First deploy

Run from the repository root (so `apps/web/Dockerfile`'s build context is
the monorepo):

```
fly deploy -a daisy-debate-staging \
  --build-arg APP_VERSION="$(git rev-parse --short HEAD)" \
  --build-arg GIT_COMMIT="$(git rev-parse HEAD)"
```

`fly.toml`'s `[deploy] release_command = "bun db:migrate"` runs once against
`DATABASE_URL` before the new release receives traffic — do not add a
migration step anywhere else.

Verify: `fly status -a daisy-debate-staging` shows one deployed release and
`fly releases -a daisy-debate-staging` shows it as successful.

## 7. Verify

```
# Health
curl -sS https://daisy-debate-staging.fly.dev/api/health/live
curl -sS https://daisy-debate-staging.fly.dev/api/health/ready

# Sign-in email delivered: start a magic-link sign-in against the running
# app (replace with a real inbox you control), then confirm Resend's
# dashboard shows the message as sent/delivered for that recipient.
curl -sS -X POST https://daisy-debate-staging.fly.dev/api/auth/sign-in/magic-link \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@yourdomain.example"}'

# Webhook event received: after the email above is delivered, check
# structured logs for an applied delivery event.
fly logs -a daisy-debate-staging --no-tail | grep -i 'mail.webhook\|delivery'
```

All three must show success before calling staging ready. Also re-run the
client-identity check from "Client identity on Fly" above.

## 8. Rollback

flyctl v0.4.105 has no dedicated rollback subcommand; redeploy a prior
release's image explicitly:

```
fly releases -a daisy-debate-staging --image     # find the prior release's image ref
fly deploy -a daisy-debate-staging --image <prior-image-ref>
```

Verify: `fly releases -a daisy-debate-staging` shows the rollback as the
newest release, and step 7's health checks pass again.

## 9. Destroy

```
fly apps destroy daisy-debate-staging
```

This deletes the app and its machines; it does **not** touch Neon or
Upstash (separate accounts/resources) — delete those in their own consoles
if the environment is being fully torn down, and revoke the Resend webhook
and its signing secret.

Verify: `fly status -a daisy-debate-staging` returns "app not found".
