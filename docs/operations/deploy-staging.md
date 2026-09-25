# Deploy: Fly.io staging (AUTH-7.0)

Scale-to-zero staging deployment of `apps/web` on Fly.io, org `daisy-debate`.
`fly.toml` (repo root) and `apps/web/Dockerfile` define the app, and
`fly.migrate.toml` the release-only migrator app beside it; this is the
operator runbook for the account-side steps a Builder agent cannot take
(creating billing-adjacent resources, setting secrets, deploying). Every
step's flag names were verified against the installed `flyctl` (v0.4.105,
`flyctl version`) and https://fly.io/docs/reference/configuration/ /
https://fly.io/docs/flyctl/ as of 2026-09-22 — re-check flag names if the
installed flyctl has since changed.

No custom domain: the app is reachable at `https://<app>.fly.dev` only
(owner decision). Postgres is an always-on Fly machine in the same org and
Redis is Fly-native Upstash (owner decision, September 22), both reached
through the `DATABASE_URL` / `MIGRATION_DATABASE_URL` / `REDIS_URL`
contract — no new client libraries.

## Database credentials (ISSUE-39, ISSUE-102)

Two Fly secrets hold two different PostgreSQL roles, in two different Fly
apps. Fly secrets are app-wide: every secret of an app is an environment
variable on every machine of that app, and on its `release_command`
machine too. Fly has no release-only or per-machine secret. A
`MIGRATION_DATABASE_URL` set on the web app would therefore sit in every
web machine's environment, not only the release command's. So the owner
credential lives in its own release-only app
([ADR 0041](../decisions/0041-migration-credential-in-a-release-only-app.md)):

| Secret                   | App                                                      | Role                                                                                            | Used by                                                                                                                                                                                               |
| ------------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MIGRATION_DATABASE_URL` | `daisy-debate-staging-migrate` (`fly.migrate.toml`) only | `daisy_migrator`, the schema owner (`fly postgres attach`, superuser, so it holds `CREATEROLE`) | That app's `release_command` (`packages/db/scripts/migrate.ts`), on a temporary machine destroyed when it exits. The runner refuses to run in production without this secret                          |
| `DATABASE_URL`           | `daisy-debate-staging` (`fly.toml`)                      | `daisy_web`, DML only (created by the baseline migration)                                       | The web app. `start.ts` refuses to start if this role can create or alter anything in schema `public`, and production config refuses to start with `MIGRATION_DATABASE_URL` in the environment at all |

The migrator app has no services and no machines. The workflow deploys it
with `--update-only`, so the only machine that ever holds the owner
credential is the release command's temporary one.

The baseline creates `daisy_web` without a password (`CREATE ROLE daisy_web
LOGIN` if it is missing). Setting that password is a one-time human step
(step 2). Creating the role with its password before the first deploy is
compatible, because the baseline skips an existing role and grants it the
same privileges.

## Idle cost (per the owner's spend constraint)

| Piece                                                                                       | Idle cost                                                                                                                                                                          | Source                             |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Fly machine (shared-cpu-1x, 512mb), stopped (`min_machines_running = 0`)                    | $0 compute. Only rootfs storage is billed while stopped: $0.15 per 1GB for 30 days (this image is ~1.2GB, so a fraction of $0.15/mo when stopped)                                  | https://fly.io/docs/about/pricing/ |
| Fly machine, running                                                                        | ~$0.00000156/s ≈ **$4.04/month if left running continuously** (region-dependent; staging should spend almost none of this since `auto_stop_machines` suspends it between requests) | https://fly.io/docs/about/pricing/ |
| Fly Postgres machine `daisy-debate-staging-db` (shared-cpu-1x 256MB, 1GB volume), always on | ≈ $1.94/month compute + $0.15/month volume. Owner decision: left running; `fly machine stop` between sessions drops it to the volume charge.                                       |
| Fly Redis `daisy-debate-staging-redis` (Upstash, Pay-as-you-go)                             | $0 at rest; $0.20 per 100K commands.                                                                                                                                               |
| Resend                                                                                      | Free tier covers low-volume staging email + webhooks; no idle cost beyond the account itself                                                                                       | https://resend.com/pricing         |

Net: about $2/month at rest (the Postgres machine), plus fractional-cent
rootfs storage and any actual staging traffic while the web machine is awake.

## Security proof against the live app (AUTH-7.8)

`bun scripts/staging-security-probe.ts [--url https://<app>.fly.dev]` proves,
with non-mutating GET/POST-with-bad-origin requests only, that the deployed
app redirects plaintext HTTP to HTTPS, sets no credentialed wildcard CORS,
never shares-caches an account response, refuses a cross-origin state
change (including the `Origin: null` scope, AUTH-4.6) and resolves one real
client identity regardless of a forged `X-Forwarded-For` or `Fly-Client-IP`.
The trusted-client-IP and secret-leak checks additionally read `fly logs`
when this machine has an authenticated flyctl session (`NOT RUN` otherwise).
It never signs in — a real Set-Cookie attribute check needs an actual
session, which is the owner's "Checklist — AUTH-6.6 real-device passkey
evidence" step; the local proof is
`apps/web/e2e/auth-routes.e2e.ts`'s "a real sign-in sets a host-only,
HttpOnly, Secure, SameSite session cookie" test, over the production
server's HTTPS front.

## Client identity on Fly (verify on first deploy)

`apps/web/src/server/ingress.ts` stamps `x-daisy-client-ip` from the raw
socket peer unless that peer is a configured trusted proxy (zero trust: a
forwarded header is only ever read from a peer the deployment names as its
own proxy). Fly's edge (fly-proxy) terminates the client's TLS connection
and forwards to the app's machine over Fly's private 6PN network
(https://fly.io/docs/networking/private-networking/, prefix `fdaa::/8`), so
the socket peer the app sees is fly-proxy's 6PN address, not the caller's —
`AUTH_TRUSTED_PROXIES` must include that range or every request collapses to
one shared rate-limit identity. Fly documents that fly-proxy sets both
`Fly-Client-IP` and `X-Forwarded-For` "including the address of the client
that originated the request"
(https://fly.io/docs/networking/request-headers/). Once the peer is
trusted, `client-ip.ts` (`resolveClientIp`, AUTH-7.9) reads `Fly-Client-IP`
directly — it is Fly's own resolved value, not a chain to walk — and only
falls back to walking `X-Forwarded-For` from the right when `Fly-Client-IP`
is absent or unusable (a non-Fly trusted-proxy deployment, or a probe with
no such header). `fly.toml` sets `AUTH_TRUSTED_PROXIES = "fdaa::/8"` — Fly
does not document a narrower CIDR specific to fly-proxy's own address, so
the whole 6PN prefix is trusted (only Fly's own infrastructure can
originate traffic on that private network; the internet cannot reach a Fly
machine's 6PN interface directly).

**This is inferred from Fly's documented header contract, not measured**:
Fly's docs do not state the literal TCP peer address an app process sees.
Confirm the real chain after first deploy by comparing, never by
recomputing: the log line's `clientIdHash` is keyed by a subkey of
`BETTER_AUTH_SECRET` (`apps/web/src/features/auth/client-ip.ts`), so it
cannot be reproduced from an address, and the raw address is never
logged (ADR 0019's loggable fields).

```
# /api/health/ready (not /live, which logs nothing) routes through
# handleOperation, whose http.request.completed log carries clientIdHash.
# Send one request from this machine and one from a different network
# (a phone hotspot, a cloud shell):
curl -s https://<app>.fly.dev/api/health/ready
fly logs -a <app> --no-tail | grep '"event":"http.request.completed"'
```

Two callers on different networks must produce two different
`clientIdHash` values, and repeat requests from one caller the same value.
If every request carries the same hash, whichever network it came from,
the ingress is resolving fly-proxy's own address rather than the caller.

Then prove a caller cannot choose its own identity. From one machine, send
two requests with different forged `X-Forwarded-For` values, and two more
with different forged `Fly-Client-IP` values:

```
curl -s https://<app>.fly.dev/api/health/ready -H "X-Forwarded-For: 203.0.113.9"
curl -s https://<app>.fly.dev/api/health/ready -H "X-Forwarded-For: 198.51.100.7"
curl -s https://<app>.fly.dev/api/health/ready -H "Fly-Client-IP: 203.0.113.9"
curl -s https://<app>.fly.dev/api/health/ready -H "Fly-Client-IP: 198.51.100.7"
fly logs -a <app> --no-tail | grep '"event":"http.request.completed"'
```

All four lines must carry the same `clientIdHash`, which is also the value
this machine logs with no forged header at all: fly-proxy overwrites both
headers with its own resolved value before the app ever sees the request,
so a caller-supplied `Fly-Client-IP` or `X-Forwarded-For` never reaches
`client-ip.ts`. A different hash on any of the four means the ingress
trusted a caller-supplied hop, so a caller could pick its rate-limit
identity.

If the resolved client address is not the real caller, widen or correct
`AUTH_TRUSTED_PROXIES` in `fly.toml` and redeploy — do not leave it unset,
since that degrades every user to one shared rate-limit bucket per auth
path (safe, but defeats per-client rate limiting).

Better Auth trusts only `x-daisy-client-ip` (`CLIENT_IP_HEADER`), stamped by
the ingress above — there is no deployment-configurable header list to set
here.

## Scale-to-zero consequences

- **The hourly retention sweep stops while suspended.**
  `apps/web/src/server/start.ts` starts `startRetentionSweep` (hourly
  `setInterval`, `runOnStart: true`) in-process. A suspended machine runs no
  process, so no interval fires; expired verification, session, outbox and
  email rows and lapsed online-presence members accumulate while stopped and are
  pruned immediately on the next wake (`runOnStart: true` runs the sweep as
  soon as the process starts again). This is inherent to
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
fly apps create daisy-debate-staging-migrate --org daisy-debate   # release-only migrator (ADR 0041)
```

Verify: `fly status -a daisy-debate-staging` and
`fly status -a daisy-debate-staging-migrate` show both apps with no machines
yet (this only reserves the names; the `app` fields of `fly.toml` and
`fly.migrate.toml` must match).

## 2. Provision Postgres

Owner decision (September 22): staging Postgres is an ordinary Fly machine
in the same org, left running (about $2/month for shared-cpu-1x 256MB plus
$0.15/GB volume), not an external provider. It is a single unmanaged
machine: no automatic backups or failover — fine for staging only.

```
fly postgres create --name daisy-debate-staging-db --org daisy-debate --region ord \
  --vm-size shared-cpu-1x --volume-size 1 --initial-cluster-size 1
# The migration owner, attached to the migrator app only. Attach creates a
# superuser login, prints its URL and sets it as that app's secret.
fly postgres attach daisy-debate-staging-db -a daisy-debate-staging-migrate \
  --database-name daisy_debate_staging --database-user daisy_migrator \
  --variable-name MIGRATION_DATABASE_URL

# The runtime role, once: a random password, then the role holding it.
DAISY_WEB_PASSWORD="$(bun -e 'console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"))')"
echo "CREATE ROLE daisy_web LOGIN PASSWORD '$DAISY_WEB_PASSWORD';" \
  | fly postgres connect -a daisy-debate-staging-db -d daisy_debate_staging
# Same host, port, database and query string as the URL attach printed;
# only the user and password differ.
fly secrets set -a daisy-debate-staging --stage \
  DATABASE_URL="postgres://daisy_web:$DAISY_WEB_PASSWORD@<host:port from attach>/daisy_debate_staging?sslmode=disable"
unset DAISY_WEB_PASSWORD
```

If `daisy_web` already exists (a deploy has run), use `ALTER ROLE daisy_web
PASSWORD '...'` instead of `CREATE ROLE`.

Verify: `fly secrets list -a daisy-debate-staging-migrate` shows only
`MIGRATION_DATABASE_URL`, and `fly secrets list -a daisy-debate-staging`
shows `DATABASE_URL` and no `MIGRATION_DATABASE_URL`.

## 3. Provision Redis

Upstash is native on Fly; the pay-as-you-go plan is free at staging volumes
($0.20 per 100K commands). The ProdPack prompt must be declined explicitly
when flyctl runs without a TTY:

```
fly redis create --org daisy-debate --region ord --name daisy-debate-staging-redis \
  --no-replicas --disable-eviction --plan "Pay-as-you-go" --enable-prodpack=false
fly redis status daisy-debate-staging-redis      # shows the private redis:// URL
fly secrets set -a daisy-debate-staging --stage REDIS_URL="<that url>"
```

Verify: `fly secrets list -a daisy-debate-staging` shows `REDIS_URL` (staged).

## 4. Create the Resend webhook (before first deploy)

Before setting `AUTH_EMAIL_FROM` (step 5), choose a sending path:

- **Normal staging delivery**: add and verify a sending domain in the Resend
  dashboard, then use a sender address from that domain (for example
  `Daisy <no-reply@yourdomain.example>`). Once verified, that domain can send
  to any recipient.
- **Account-only smoke test**: use the built-in `onboarding@resend.dev`
  sender with no domain setup. Resend restricts this sender to delivering
  only to the email address registered on the Resend account
  (https://resend.com/docs/knowledge-base/403-error-resend-dev-domain) — any
  other recipient gets a 403. Step 7's sign-in check must target that same
  account email when this path is chosen.

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
# DATABASE_URL was set in step 2 and REDIS_URL staged in step 3; do not set
# them again here. MIGRATION_DATABASE_URL belongs to the migrator app only.
fly secrets set -a daisy-debate-staging --stage \
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
values — Fly never displays a set secret's value back), and no
`MIGRATION_DATABASE_URL`.

## 6. First deploy

Run from the repository root (so `apps/web/Dockerfile`'s build context is
the monorepo):

```
# 1. Migrate: the migrator app's release command, no machines created.
fly deploy -c fly.migrate.toml --remote-only --update-only \
  --build-arg APP_VERSION="$(git rev-parse --short HEAD)" \
  --build-arg GIT_COMMIT="$(git rev-parse HEAD)"
# 2. Only after step 1 succeeds: the web app.
fly deploy -a daisy-debate-staging --ha=false \
  --build-arg APP_VERSION="$(git rev-parse --short HEAD)" \
  --build-arg GIT_COMMIT="$(git rev-parse HEAD)"
```

`fly.migrate.toml`'s `[deploy] release_command = "bun /app/packages/db/scripts/migrate.ts"`
runs once as `MIGRATION_DATABASE_URL`, before the web release. Its session
gives up on a lock after 1 s (ISSUE-112), so a migration blocked by live
traffic fails step 1 and step 2 never runs. Do not add a migration step
anywhere else, and never add a `release_command` to `fly.toml`. The web app
starts as `DATABASE_URL` (`daisy_web`). A release still pointing
`DATABASE_URL` at the owner fails startup with "Production refuses a
DATABASE_URL role that …". A web app that still holds
`MIGRATION_DATABASE_URL` fails startup with "Invalid server configuration:
MIGRATION_DATABASE_URL".

Verify: `fly releases -a daisy-debate-staging-migrate` shows the release as
successful and `fly machines list -a daisy-debate-staging-migrate` lists no
machines. `fly status -a daisy-debate-staging` shows one deployed release
and `fly releases -a daisy-debate-staging` shows it as successful.

`--ha=false` keeps one machine: without it `fly deploy` creates two for
high availability, which doubles the (idle-free) footprint and is
pointless for staging. If two exist, `fly scale count 1 -a daisy-debate-staging`.

## 6a. Move an existing owner credential off the web app (ISSUE-102)

Staging deployed before ISSUE-102 holds `MIGRATION_DATABASE_URL` as a secret
of the web app, so it has been in every web machine's environment. This is a
one-time owner step. Rotate the password rather than copy the old value,
because the old value was on web machines. Run it before the first deploy
of a main that includes ISSUE-102: that deploy's migrate step needs the
migrator app, and its web machines refuse to start while the web app still
holds the secret.

```
# Confirm the exposure first: prints the owner URL from a web machine.
fly ssh console -a daisy-debate-staging -C 'printenv MIGRATION_DATABASE_URL'

fly apps create daisy-debate-staging-migrate --org daisy-debate

# New owner password; set it only on the migrator app.
DAISY_MIGRATOR_PASSWORD="$(bun -e 'console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"))')"
echo "ALTER ROLE daisy_migrator PASSWORD '$DAISY_MIGRATOR_PASSWORD';" \
  | fly postgres connect -a daisy-debate-staging-db -d daisy_debate_staging
# Same host, port, database and query string as the old owner URL;
# only the password differs.
fly secrets set -a daisy-debate-staging-migrate --stage \
  MIGRATION_DATABASE_URL="postgres://daisy_migrator:$DAISY_MIGRATOR_PASSWORD@<host:port>/daisy_debate_staging?sslmode=disable"
unset DAISY_MIGRATOR_PASSWORD

# Remove it from the web app. --stage keeps the running release up until
# the next deploy replaces its machines.
fly secrets unset -a daisy-debate-staging --stage MIGRATION_DATABASE_URL

fly tokens create deploy -a daisy-debate-staging-migrate --name github-actions-staging-migrate --expiry 8760h \
  | gh secret set FLY_MIGRATE_API_TOKEN
```

Verify after the next staging deploy:
`fly secrets list -a daisy-debate-staging` has no `MIGRATION_DATABASE_URL`,
`fly ssh console -a daisy-debate-staging -C 'printenv MIGRATION_DATABASE_URL'`
prints nothing and exits non-zero,
`fly machines list -a daisy-debate-staging-migrate` lists no machines, and
the "Deploy staging" run shows `migrate` then `deploy` green.

## 7. Verify

```
# Health
curl -sS https://daisy-debate-staging.fly.dev/api/health/live
curl -sS https://daisy-debate-staging.fly.dev/api/health/ready

# Sign-in email delivered: start a magic-link sign-in against the running
# app, then confirm Resend's dashboard shows the message as sent/delivered
# for that recipient. If AUTH_EMAIL_FROM uses onboarding@resend.dev (step 4
# account-only path), this MUST be the Resend account's own email address —
# any other recipient gets a 403 and the email never sends. Otherwise use
# any real inbox you control under the verified sending domain.
curl -sS -X POST https://daisy-debate-staging.fly.dev/api/auth/sign-in/magic-link \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://daisy-debate-staging.fly.dev' \
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

Rolling back the web image never rolls back the schema: migrations are
forward-only and expand/contract, so the previous release still runs
against the newer schema. Do not redeploy the migrator app to roll back.

Verify: `fly releases -a daisy-debate-staging` shows the rollback as the
newest release, and step 7's health checks pass again.

## 9. Destroy

```
fly apps destroy daisy-debate-staging --yes
fly apps destroy daisy-debate-staging-migrate --yes
fly apps destroy daisy-debate-staging-db --yes      # the Postgres machine and its volume (the recurring charge)
fly redis destroy daisy-debate-staging-redis --yes
```

Then delete the Resend webhook (`resend webhooks delete <id>`) and rotate
`FLY_API_TOKEN` and `FLY_MIGRATE_API_TOKEN` out of the GitHub repository
secrets (`fly tokens revoke`, `gh secret delete FLY_API_TOKEN`,
`gh secret delete FLY_MIGRATE_API_TOKEN`).

Verify: `fly status -a daisy-debate-staging`,
`fly status -a daisy-debate-staging-migrate` and
`fly status -a daisy-debate-staging-db` all return "app not found", and
`fly redis list` no longer lists the database.

## 10. Continuous deployment (GitHub Actions)

`.github/workflows/deploy-staging.yml` deploys a `main` push once its CI
gate job and its Browser E2E run are both green, checked out at the
verified `head_sha`, or on manual `workflow_dispatch`. Both workflows
trigger it on completion; `scripts/staging-gate.ts` reads the two runs for
the commit and lets only the later completion deploy, so each commit ships
once, and only while it is still `main`'s tip: re-running an older commit's
CI or E2E never rolls staging back. The CI gate needs the dependency audit
job (ADR 0039), so a new advisory holds staging back and posts to
Incidents. The deploy job's `migrate` step deploys the migrator app
(`fly.migrate.toml`, `--update-only`) and its `deploy` step, which runs
only after `migrate` succeeds, deploys the web app. The workflow needs two
repository secrets, each a deploy token scoped to one app and exposed only
on its own step:

```
fly tokens create deploy -a daisy-debate-staging --name github-actions-staging --expiry 8760h \
  | gh secret set FLY_API_TOKEN
fly tokens create deploy -a daisy-debate-staging-migrate --name github-actions-staging-migrate --expiry 8760h \
  | gh secret set FLY_MIGRATE_API_TOKEN
```

Each token can deploy only its own app; rotate one by re-running its
command. Production is never deployed by this workflow (AUTH-7.2/7.3 are
human-gated). Verify: the "Deploy staging" run is green after a main merge
and `/api/health/ready` answers at the staging hostname.

A failed deploy posts to the drive's Incidents channel, the same way
`ci.yml` reports CI failures. The workflow's `notify-drive` job runs when
the gate job or the deploy job fails and calls `scripts/notify-drive.ts
incidents --deploy daisy-debate-staging`. The message names the app, the
first failing step (`<job>.<step id>`, for example `deploy.readiness`), the
commit and the run URL. It never carries flyctl output, secrets or
database URLs. The job holds only the Incidents webhook URL and secret
(`PAGESPACE_INCIDENTS_WEBHOOK_URL`, `PAGESPACE_INCIDENTS_WEBHOOK_SECRET`,
the repository secrets `ci.yml` already uses), scoped to the step that
posts.
