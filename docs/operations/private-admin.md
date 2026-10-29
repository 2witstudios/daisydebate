# Private mobile admin

The operator opens **https://daisy-admin.tail51baf2.ts.net** with Tailscale
connected, enrolls an additional passkey, then signs in and approves accounts.
The app is separate from participant identity and storage. Tailnet membership
admits a connection, never an operator. Every participant change still uses
the signed, scoped, audited operator API (ADRs 0043, 0077 and 0079).

## Topology and configuration

One Fly machine in `ord`, no public IP, `http_service` or `services`, runs
Tailscale **1.104.4** userspace networking and private HTTPS Serve. Serve
terminates TLS and proxies to `http://127.0.0.1:8080`. The application binds
only loopback. Serve preserves Host; the app discards Forwarded,
X-Forwarded-* and Tailscale-* headers before Next. It uses the actual socket
peer for rate limiting (all proxied operators share that bucket), never
Tailscale identity headers for authorization. No public Funnel, Tailscale SSH,
exit node, subnet routes, DNS adoption, tags or policy rewrite is required.
The existing home Mac Serve configuration on port 3000 is untouched.

Committed non-secret settings in `fly.admin.toml`:

- `ADMIN_ORIGIN=https://daisy-admin.tail51baf2.ts.net`
- `ADMIN_HOST=127.0.0.1`, `ADMIN_PORT=8080`
- volume source `admin_tailscale_state`, mounted `/var/lib/tailscale`
- immediate (stop-first) deployments, one persistent node, no HA clone

The origin must be an exact canonical HTTPS origin without credentials,
path, query, fragment or normalization. Production has no HTTP fallback.
The RP ID is derived from its hostname; both option generation and signature
verification receive it. Host and state-changing Origin checks run before
Next, then actions repeat the exact Origin check. Sessions are host-only,
HttpOnly, SameSite=Strict, Path=/ and Secure on HTTPS. Local development alone
defaults to `http://localhost:4800`.

The encrypted 1GB `ord` volume provisioned 2026-10-29 is
`vol_r1j7e20jlw3j90zr`. At planning it was unattached; this is provisioning
metadata, not evidence of activation. It contains node keys and certificate
state: root-owned mode 0700, never copied into the repository, logs, PR or
PageSpace. The app runs as `daisy` and cannot read it. No reusable join key is
stored. Volume loss requires explicit operator recovery; startup never joins
a fresh node or silently accepts a suffixed hostname.

The supervisor validates app configuration and the mounted volume, starts
only tailscaled, and waits for the exact DNS identity in Running state. During
NeedsLogin/NeedsMachineAuth/expired-key/wrong-name states the private Fly exec
socket remains available and the application has no listener. Daemon output
is suppressed because it can include authentication URLs. After identity and
safe network preferences are verified, it resets persisted Serve/Funnel
configuration, installs the sole private HTTPS handler, and only then starts
the app. A restored handler therefore has no application backend during
admission. The state directory is trusted root-managed operational material;
this does not claim protection from an operator who rewrites daemon state.
Daemon or app exit ends the supervisor; SIGINT/SIGTERM drains both with a
15-second bound. Do not enable a second listener or proxy to another backend.

## Initial volume adoption (parent executes before main merge)

This differs from normal deploy: Fly cannot attach a new volume to an
existing volumeless machine in place. Main merges automatically deploy admin;
complete adoption before merging this slice. The workflow also fails closed
unless exactly one managed `app` machine has the dedicated encrypted `ord`
volume at the sole expected mount and every other machine is stopped. It uses
`--only-machines <selected-id> --strategy immediate --ha=false`; the stopped
rollback machine is never selected even with its existing managed metadata.

Known rollback machine: `e8205e4b49e458`, shared1x/512MB, original image
`registry.fly.io/daisy-debate-staging-admin:deployment-01M644B2KSJ5G6KGEBQ2CEM8YJ`.
Parent verifies these non-secret facts at action time. Never print or export
app secrets or complete environment/config values.

From the reviewed candidate checkout, build/push without deploying, recording
the resulting digest-pinned candidate image reference (`registry.fly.io/...@sha256:...`) and exact Git SHA:

```sh
fly deploy -c fly.admin.toml --build-only --push --local-only \
  --build-arg APP_VERSION="$(git rev-parse --short HEAD)" \
  --build-arg GIT_COMMIT="$(git rev-parse HEAD)"
```

Then stop the original, clone it with the existing new volume and a temporary
sleep command (so the old image cannot serve), and record the new machine ID:

```sh
fly machine stop e8205e4b49e458 -a daisy-debate-staging-admin
fly machine clone e8205e4b49e458 -a daisy-debate-staging-admin \
  --name daisy-admin-private --region ord \
  --attach-volume vol_r1j7e20jlw3j90zr:/var/lib/tailscale \
  --override-cmd 'sleep infinity'
```

The clone inherits app secrets and the managed `v2`/`app` metadata; no secret
copy is needed. With `admin_machine` and `admin_candidate_image` set to the
recorded non-secret IDs (candidate image must use `@sha256:...`), target only the replacement:

```sh
fly machine update "$admin_machine" -a daisy-debate-staging-admin \
  --image "$admin_candidate_image" --command 'bash src/server/private-ingress.sh' \
  --env ADMIN_ORIGIN=https://daisy-admin.tail51baf2.ts.net \
  --env ADMIN_HOST=127.0.0.1 --env ADMIN_PORT=8080 --restart on-failure
```

Check only machine IDs/states, mount volume/path and managed metadata; original
must remain stopped, replacement must have exactly the intended volume, no
services/public IP, and no application listener before registration. Do not
run generic deploy/scale to perform adoption or boot both machines.

## One-time interactive registration (parent and owner)

Open a private interactive Fly console on the replacement (use the selector
or `--machine` supported by the installed flyctl). Run inside it as root:

```sh
tailscale --socket=/run/tailscale/tailscaled.sock up \
  --hostname=daisy-admin --accept-dns=false --accept-routes=false \
  --ssh=false --advertise-routes= --advertise-exit-node=false
```

The login URL is sensitive: show it only in the owner's private session, never
capture it in agent logs, a transcript, PR or PageSpace. The owner approves
this concrete device in the authenticated Tailscale console and, if prompted,
enables tailnet HTTPS certificate issuance. Hostname availability was checked,
not reserved: require exact `daisy-admin.tail51baf2.ts.net`; a suffixed name
fails admission. No auth key, ephemeral flag, tag or broad ACL edit is used.
Existing member allow-all policy is unchanged; app passkeys remain mandatory.

Observe BackendState, exact DNSName and node ID privately, then check Serve
status: private HTTPS 443 to 127.0.0.1:8080 only and no AllowFunnel entry.
The supervisor refuses unsafe SSH/DNS/route/exit preferences. Check off-tailnet
and Fly public hostname access fails; direct 6PN :8080 must also fail because
the app binds loopback. On-tailnet anonymous `/accounts` must redirect to
sign-in. Record only sanitized outcomes and candidate SHA.

## Add the owner's mobile passkey

Existing localhost passkeys remain stored and are not migrated: they cannot
assert for a different RP. In the same private Fly console, use the existing
operator's exact name:

```sh
cd /app/apps/admin
bun src/scripts/operator-enroll.ts --name owner --additional
```

The one-use 15-minute link carries its token in the fragment. Deliver it
privately to the owner, never through logs/chat/PR/PageSpace. Do not run
`--replace`, revoke credentials or create a replacement operator. The owner
opens the link in Safari on the tailnet-connected iPhone (or iPad), chooses
Create passkey and completes the real biometric prompt. Then sign in and open Pending. Actual approval of a participant is a separate
owner choice; setup does not select an account or authorize a test approval. The usual revision, audit and
signed API checks still apply. The owner reports the result without sharing
link, cookie, attestation or credential material. A virtual authenticator is
fixture proof only: **setup is not complete until this real-device acceptance
is recorded**. Code PR_READY and setup completion are distinct.

## Steady-state deploy, renewal and recovery

After adoption the automatic workflow validates the topology and targets only
the persistent machine. Manual deployments use the same preflight and target:

```sh
admin_machines=$(mktemp)
admin_volumes=$(mktemp)
trap 'rm -f "$admin_machines" "$admin_volumes"' EXIT
fly machine list -a daisy-debate-staging-admin --json > "$admin_machines"
fly volumes list -a daisy-debate-staging-admin --json > "$admin_volumes"
admin_target=$(bun scripts/admin-deploy-target.ts "$admin_volumes" < "$admin_machines")
fly deploy -c fly.admin.toml --local-only --ha=false --no-public-ips \
  --only-machines "$admin_target" --strategy immediate
```

Keep the same attached volume. Never run two copies of its identity, clone a
logged-in state into another running machine, or use bluegreen/canary/HA.
Expected brief downtime is deliberate. Verify unchanged node ID, exact DNS,
valid HTTPS, no Funnel, no public access and passkey sign-in after both a
restart and a candidate redeploy. These are runtime acceptance steps, not
inferences from configuration. Before merge parent records adoption and proof
or reports a blocker; the preflight cannot silently downgrade to a tunnel.

Persistent disk does **not** disable node-key expiry. Keep expiry enabled;
parent observes the device's expiry date in the Tailscale console, schedules
renewal before it, and explicitly reauthenticates this same node when needed.
An expired/disconnected node makes admin unavailable; do not create a new
identity to mask it. Serve requests/renews HTTPS certificates automatically
while the daemon is connected, HTTPS is enabled, and issuance is allowed.
Check certificate validity and connectivity during deploy/restart checks;
certificate/HTTPS authorization failures fail closed, never downgrade to HTTP.

For reversible initial rollback, stop the replacement first, confirm it has
stopped, then start only the retained original with its original image/config.
The old localhost credential rail exists only in that retained image, not as
a new app mode. Once the parent and owner have verified mobile acceptance,
parent retires the temporary rollback machine under its external authority;
never delete the persistent state volume as routine deploy cleanup. The
builder does not execute or self-approve any of these external operations.

## Evidence boundaries and references

Unit tests prove canonical configuration, Host/Origin rejection, matching
WebAuthn options/verification and ingress status/prefs decisions. Real admin
DB integration proves additional HTTPS enrollment preserves existing passkeys
and wrong-RP assertions issue no session. The Chromium journey uses ephemeral
local TLS, 390px viewport, Secure cookies and user-verified virtual WebAuthn,
then approves through a signature-verifying participant API fixture. This is
not a claim that automated tests exercised iOS biometrics, Tailscale control
plane registration, certificate renewal, stale Funnel cleanup or live
restart/redeploy identity; parent/owner record those runtime observations.

Official sources read before implementation: [Tailscale Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve),
[container state](https://tailscale.com/docs/features/containers/docker/docker-params),
[1.104.4 daemon flags](https://github.com/tailscale/tailscale/blob/v1.104.4/cmd/tailscaled/tailscaled.go),
[1.104.4 Serve persistence and proxy](https://github.com/tailscale/tailscale/blob/v1.104.4/ipn/ipnlocal/serve.go),
[Fly volume update limitation](https://fly.io/docs/machines/flyctl/fly-machine-update/),
[Fly clone and attach-volume](https://fly.io/docs/flyctl/machine-clone/),
[Fly deploy target selection](https://fly.io/docs/flyctl/deploy/).
