# Operational log pipeline (staging runbook)

The shipper reads the event stream from Fly's org log stream, the ClickHouse
store keeps it for 28 days, and the admin Security page reads it
([ADR 0084](../decisions/0084-operational-log-pipeline.md)). This runbook
covers staging, org `daisy-debate`. Production is a separate owner step
(below).

| App                                | Config                 | Image                                      | Reachability     |
| ---------------------------------- | ---------------------- | ------------------------------------------ | ---------------- |
| `daisy-debate-staging-clickhouse`  | `fly.clickhouse.toml`  | `infra/clickhouse/Dockerfile`              | 6PN only, no IPs |
| `daisy-debate-staging-log-shipper` | `fly.log-shipper.toml` | `apps/web/Dockerfile` target `log-shipper` | 6PN only, no IPs |

Never print a secret. Each one below is generated and piped straight into
`fly secrets set` in the same command.

## First rollout

1. Create the apps and the volume. Scheduled snapshots are off, because no
   copy may outlive the TTL:

   ```sh
   fly apps create daisy-debate-staging-clickhouse --org daisy-debate
   fly apps create daisy-debate-staging-log-shipper --org daisy-debate
   fly volumes create clickhouse_data -a daisy-debate-staging-clickhouse \
     --region ord --size 10 --scheduled-snapshots=false --yes
   ```

2. Generate the two role passwords with the OS CSPRNG and stage each one on
   both apps that use it, without printing it:

   ```sh
   shipper="$(openssl rand -base64 33 | tr -d '\n=' | tr '+/' '-_')"
   reader="$(openssl rand -base64 33 | tr -d '\n=' | tr '+/' '-_')"
   fly secrets set --stage -a daisy-debate-staging-clickhouse \
     CLICKHOUSE_SHIPPER_PASSWORD="$shipper" CLICKHOUSE_READER_PASSWORD="$reader" >/dev/null
   fly secrets set --stage -a daisy-debate-staging-log-shipper \
     CLICKHOUSE_SHIPPER_PASSWORD="$shipper" >/dev/null
   fly secrets set --stage -a daisy-debate-staging-admin \
     CLICKHOUSE_URL="http://daisy-debate-staging-clickhouse.internal:8123" \
     CLICKHOUSE_READER_PASSWORD="$reader" >/dev/null
   unset shipper reader
   ```

3. Stage the read-only org token (DEC-253). It expires within 90 days:

   ```sh
   printf 'NATS_TOKEN=%s\n' "$(fly tokens create readonly -o daisy-debate \
       -n log-shipper-staging -x 2160h)" \
     | fly secrets import --stage -a daisy-debate-staging-log-shipper >/dev/null
   ```

   This token can read every app's logs and config in the org. That is why
   it lives only on the 6PN-only shipper, and why production never shares
   this org.

4. Create the app-scoped deploy tokens as repository secrets
   `FLY_CLICKHOUSE_API_TOKEN` and `FLY_LOG_SHIPPER_API_TOKEN`
   (`fly tokens create deploy -a <app>`, piped to `gh secret set`). Until both
   exist, `deploy-staging.yml` reports these steps as unconfigured.

5. Deploy the store, then the shipper, then redeploy the admin app (which
   applies its staged secrets). Never allocate an address:

   ```sh
   fly deploy -c fly.clickhouse.toml --ha=false --no-public-ips
   fly deploy -c fly.log-shipper.toml --ha=false --no-public-ips \
     --build-arg APP_VERSION="$(git rev-parse --short HEAD)" --build-arg GIT_COMMIT="$(git rev-parse HEAD)"
   fly deploy -c fly.admin.toml --ha=false --no-public-ips \
     --build-arg APP_VERSION="$(git rev-parse --short HEAD)" --build-arg GIT_COMMIT="$(git rev-parse HEAD)"
   ```

## Verify

- Run `fly apps list -o daisy-debate`. It must list only `daisy-debate-staging*`
  apps (DEC-253: the org boundary is what limits the read-only token). Repeat
  this at each token rotation. Recorded 2026-10-27: daisy-debate-staging,
  -admin, -admin-migrate, -clickhouse, -db, -livekit, -log-shipper,
  -media-worker, -migrate, -realtime.
- Run `fly ips list` for both apps. Each must print no address.
- Run `fly logs -a daisy-debate-staging-log-shipper --no-tail`. It must show
  `logship.started`, and no repeating `logship.insert.failed`.
- Run `fly proxy 4800:8080 -a daisy-debate-staging-admin` and open
  `http://localhost:4800/security`. Check three things:
  - The coverage line reads "Shipper live". "Coverage degraded" right after
    a fix can be refusals from the past hour that are ageing out.
  - Every app that writes the stream shows a recent line.
  - Retention reads "inside its lifecycle" with a recent "Last partition
    sweep".
- The reader role is read-only. From the admin machine,
  `fly ssh console -a daisy-debate-staging-admin` makes any INSERT as
  `daisy_admin_reader` fail with "readonly".

## Operations

- **Rotate the org token** before it expires (at most every 90 days). First
  confirm that `fly apps list -o daisy-debate` lists only staging apps, then
  repeat step 3 without `--stage`, then revoke the old token
  (`fly tokens list` / `fly tokens revoke`). The shipper reconnects with the
  new one on restart.
- **Rotate a role password**: repeat step 2 for that role, then restart the
  store, the shipper and the admin app.
- **Retention.** The entrypoint's hourly sweep (`infra/clickhouse/sweep.sql`)
  drops every daily partition dated 29 or more days ago. The TTL usually
  removes them earlier. If the Security page shows "Retention overdue" or
  "unverified":
  1. Check the store's stdout for `partition sweep failed`.
  2. Check `daisy_meta.sweeps` for the last completed sweep.
  3. Restart the store machine; the sweep runs on boot.
- **Schema change.** Add `infra/clickhouse/migrations/NNNN_<name>.sql`
  (idempotent, nullable `ADD COLUMN IF NOT EXISTS` for a new loggable field).
  Deploy the store before the shipper and the admin app. Never edit an
  applied file.
- **Restart loss.** Records published while the shipper is down are not
  replayed (ADR 0084 §3). The heartbeat's reconnect count and the coverage
  line show the gap.

## Production (owner step)

Production runs in its own Fly org, never `daisy-debate`. Repeat the rollout
there with its own store, shipper, passwords, read-only org token and deploy
tokens. Name the production apps in `SHIPPER_APPS`, and record the sign-off
in a human-only leaf before any production data flows. No agent performs
this step.
