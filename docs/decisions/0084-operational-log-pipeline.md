# 0084: Operational log pipeline and security views

Status: accepted. DEC-252 made the decision on the owner's behalf, and DEC-253
settled the org-token boundary. Astra reviewed the plan
(`jsar6r74egkjc9ewyk7l8z2r`, v2). This ADR amends
[ADR 0015](0015-event-stream-as-observability-source-of-truth.md): staging now
retains and routes the event stream. It applies
[ADR 0036](0036-privacy-by-design.md) and DEC-42's 30-day ceiling to the
store, and keeps [ADR 0043](0043-no-admin-surface-in-participant-app.md) and
[ADR 0077](0077-admin-app-architecture.md): the views live only in the admin
app. [ADR 0037](0037-error-tracking-and-product-analytics.md) is unchanged.
Sentry and PostHog stay inert until the owner creates their accounts.

## Context

Until now, Fly's 7-day log search was the only place the event stream
persisted (privacy.md, "Operational logs"). Operators need security views
over a longer window: auth denials and rate limits, operator API refusals and
commands, realtime closes, invariant violations, and error rates. These views
must not add a vendor, change how any app logs, or put an admin surface in
the participant app.

## Decision

### 1. One producer, one vocabulary

The apps keep writing pino JSON to stdout, unchanged. The shipper admits a
line only if this logger could have written it. `@daisy/logger/ingest`
(`admitLogLine`) applies the same event registry, field table and value kinds
the logger writes with. Those three now live in a pino-free `vocabulary.ts`,
so admission loads no logging runtime.

- The line must be a JSON object of at most 8 KiB.
- `event` must be registered, and pino's `level` must equal the registry's
  severity for it.
- `time` must be an epoch-millisecond integer.
- `service`, `appVersion` and `gitCommit` must match
  `^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$`, which admits short and full SHAs.
- `pid`, `hostname` and `msg` are dropped unread.
- Every other key must be a loggable field of its declared kind.

Anything else drops the whole line with a closed reason (`json`, `event`,
`level`, `base`, `field`). A dropped line is counted, never stored or logged
raw.

### 2. Collection

`apps/log-shipper` (`daisy-debate-staging-log-shipper`) runs on 6PN with no
public address.

**Subscription.** It subscribes to Fly's org log stream (NATS at
`[fdaa::3]:4223`, user = org slug) on one subject per configured app,
`logs.<app>.>`. Every subscription joins the queue group
`daisy-log-shipper`, so however many shipper machines overlap (a scale-up, a
clone, a rolling deploy), each record reaches exactly one of them and is never
inserted twice under two batch tokens. The subscription uses a callback, so
the client never queues unread messages.

**Checks on each record.** A record is refused, before or after it is
decoded, when any of these holds:

- It is larger than 16 KiB (`size`).
- Its envelope is malformed (`envelope`).
- Its envelope names a different app from the subscription it arrived on
  (`placement`). Fly's stream delivers each record under the
  subscription's own subject, `logs.<app>.>`, so the broker attests only
  the app. Region and instance are checked only against a concrete
  `logs.<app>.<region>.<instance>` subject (observed on staging,
  2026-10-27).
- Its app is not configured (`app`).
- Its source time is more than 5 minutes ahead of, or 1 hour behind, the
  shipper's receipt time (`time`).

**Buffering.** The buffer is capped at 5 000 rows and 8 MiB of line bytes
(UTF-8). The batch in flight counts against both caps until its rows are
stored, so buffered plus in flight never exceeds either. Arrivals past either
cap are counted as `backpressure`. Drop tallies are keyed
by (app, reason), which bounds their cardinality whatever the outage length.
Each tally is stamped with the minute it is taken.

**Inserts.** One batch is in flight at a time, with a 10 s timeout. A failed
insert backs off to 30 s and resends the same batch, rows first and then
tallies, under the same `insert_deduplication_token`. The tables set
`non_replicated_deduplication_window`, so a stored insert whose response was
lost is stored once. With one insert in flight per shipper, the retry of a
batch always precedes the next batch's insert, so the 1 000-insert
deduplication window can never evict a token before its retry. Identical
events in different batches are both kept; nothing is deduplicated by
content.

**Heartbeat.** Each minute the shipper writes a heartbeat row with its NATS
state, reconnect count and backlog.

New logger events: `logship.started` and `logship.insert.failed` (`errorCode`
and `pending` only). The shipper subscribes to its own app as well, so these
events reach the store once it recovers.

### 3. Delivery contract

- **At-most-once in.** Fly's core NATS stream does not replay. Records
  published while the shipper is disconnected or restarting are lost.
- **Retry-idempotent into ClickHouse.** A retried insert is stored once.
- **Counts are lower bounds.** The Security page shows coverage
  independently of counts.
  - A heartbeat older than 3 minutes, one that is not connected, or none at
    all marks the page "coverage unknown".
  - A live shipper that refused at least as many lines as it stored for an
    app in the last hour marks it "coverage degraded" and names the app.
  - Zero events never reads as healthy.
  - A failed store read renders "could not be read", never an empty table.

### 4. Store

`daisy-debate-staging-clickhouse` runs the `infra/clickhouse/Dockerfile`
image: ClickHouse 26.8 LTS, pinned by digest.

**Network.** It runs on 6PN with no `[http_service]`, deployed
`--no-public-ips`. HTTP (8123) is open to 6PN. Native TCP is used only by the
entrypoint. The MySQL, PostgreSQL and interserver ports are off.

**Roles** (`users.d/daisy.xml`; passwords come from environment variables
that are Fly secrets):

| Role                 | Network           | Grants                                                                                                | Profile                                                                                      |
| -------------------- | ----------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `default`            | loopback only     | admin                                                                                                 | applies migrations, sweeps partitions                                                        |
| `daisy_shipper`      | `fdaa::/16` (6PN) | `INSERT ON daisy_logs.*`                                                                              | 30 s, 256 MiB, 2 concurrent                                                                  |
| `daisy_admin_reader` | `fdaa::/16` (6PN) | `SELECT ON daisy_logs.*`, `daisy_meta` migrations and sweeps, part metadata columns of `system.parts` | `readonly = 1`; 10 s, 256 MiB, 50 M rows read, 10 000 result rows, 4 concurrent, all `throw` |

**Schema.** Migrations are versioned forward files under
`infra/clickhouse/migrations/`. The entrypoint applies each file once, in
order, and records it in `daisy_meta.schema_migrations`. Each statement is
idempotent as well. A new loggable field ships a nullable
`ADD COLUMN IF NOT EXISTS` migration first. The deploy order is store, then
shipper, then admin. An older shipper omits the new column (it stays null),
and an older admin never selects it. A unit test holds the `events` columns
equal to `loggableFields`.

### 5. Retention: the honest ceiling

DEC-42 caps operational logs at 30 days. ClickHouse TTL deletes during
background merges, not at the exact instant a row expires. The ceiling
therefore rests on several mechanisms together:

- **Retention runs on receipt time.** It uses the shipper's own clock
  (`received_at`), never the source time. A source time far from receipt is
  refused (section 2), so a forged future time cannot extend retention.
- **TTL and partitions.** The TTL is `received_at + 28 days`. Partitions are
  daily, with `ttl_only_drop_parts = 1` and `merge_with_ttl_timeout = 3600`.
  A whole day expires by day + 29. `merge_with_ttl_timeout` is only the
  minimum gap between TTL merges, not a deadline, so the TTL alone bounds
  nothing.
- **Hourly sweep: the bound.** Every hour the entrypoint runs
  `infra/clickhouse/sweep.sql` with today's UTC date. It drops every
  daily partition dated `<= today - 29`. Day D's partition is therefore
  dropped by the first sweep of day D + 29. A row received at the very start
  of D is then at most 29 days and 1 hour old, about 23 hours inside the
  ceiling. Every client call has a 300 s timeout, so a hung call cannot
  stall the loop. A sweep is recorded in `daisy_meta.sweeps` (28-day TTL)
  only when the partition listing and every drop succeeded. Any failure
  returns non-zero, unrecorded, and prints `partition sweep failed`
  (`infra/clickhouse/sweep.sh`, tested with a stubbed client in
  `scripts/clickhouse-sweep.test.ts`). An integration test runs `sweep.sql`
  with injected dates.
- **Bounded reads.** No read goes past 28 days: the longest window on the
  Security page is 28 days.
- **Monitoring.** The Security page shows each table's oldest stored row.
  It marks retention "overdue" when any row is older than 29 days 2 hours,
  which is one sweep interval past the designed worst case of 29 days 1
  hour and still under 30 days. It marks it "unverified" when no sweep
  has completed in the last two hours, and it shows the last sweep's time.
- **No other copies.** The volume is created with scheduled snapshots off,
  and there are no backups. Every ClickHouse internal log table is disabled.
  The server log goes to stdout, which Fly's 7-day search keeps.

The guarantee: no stored row outlives 30 days while the sweep runs. The
remaining failure boundary is a sweep that keeps failing for about 23 hours
(the store machine stopped, or its drops failing). A stopped machine deletes
nothing until it restarts, and the sweep then runs on boot, before anything
else is read. A failing sweep is visible within two hours as "unverified" on
the Security page, and in the store's stdout as `partition sweep failed`.
Restoring the sweep is a runbook step.

### 6. The org token (DEC-253)

Fly's log stream accepts only an org token. No narrower Fly capability
exists. A read-only org token (`fly tokens create readonly`) can read every
app's logs and config in its org, which is why the shipper holds it only as a
Fly secret on a 6PN-only machine. Its expiry is at most 90 days, and the
runbook carries the rotation step.

The enforced attenuation is the Fly org boundary. The `daisy-debate` org
holds staging apps only. Production launches in its own Fly org with its own
store, shipper and token, as an owner step. Subject filtering is hygiene, not
a security boundary.

### 7. Admin views

`/security` lives in `apps/admin` only. The new operator action
`security.read` is authorized on every request, and a denial is audited as
`access.denied`.

The page offers five views: Auth, Operator, Realtime closes, Invariants and
Errors (plus shipper drops). Each section is fixed SQL in
`features/security/sections.ts`. Every query binds `{from}` and `{to}` from a
closed window set (1 h, 24 h, 7 d, 28 d) and ends in a LIMIT. The reader's
client times out at 10 s, matching its profile.

The page needs `CLICKHOUSE_URL` and `CLICKHOUSE_READER_PASSWORD`, both or
neither. With neither, the page says the log store is unconfigured. With one
alone, the app refuses to start.

## Consequences

- privacy.md's "Operational logs" records the store and its retention. The
  `events` columns carry no personal, sensitive or secret field.
  `requestId`, `traceId`, `userId`, `actorId`, `providerMessageId` and
  `clientIdHash` are identifiers scoped to the log surface. Erasure is by
  expiry.
- The compose stack and CI's integration job run the same ClickHouse image.
  The log store suites need `TEST_CLICKHOUSE_URL`, which must be loopback.
- `deploy-staging.yml` deploys the store and then the shipper, each with its
  own token. A missing token reports the step as unconfigured, not as
  deployed. Like LiveKit, the store redeploys only when its files change.
- Production is a documented owner step
  (`docs/operations/log-pipeline.md`). It needs its own Fly org, store,
  shipper, token and sign-off.
