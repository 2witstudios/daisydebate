# 0032: Transactional outbox delivery

Status: accepted (2026-09-22). Amends [ADR 0003](0003-modular-monolith.md),
[ADR 0008](0008-redis-ephemeral.md) and
[ADR 0009](0009-portable-protocol.md).

## Context

Daisy needs live delivery: phase and turn changes, presence, chat,
notifications and standings reach browsers without a reload. The realtime
epic puts delivery in a separate `apps/realtime` service (native
WebSocket on `Bun.serve`) while `apps/web` stays the only writer: every
command arrives over HTTP and commits in PostgreSQL.

That leaves one question: how does a committed write reach every realtime
instance? PageSpace answered it with fire-and-forget HTTP broadcasts from
web to realtime, signed with one shared HMAC secret. Events were lost
whenever realtime was down, non-2xx responses counted as success, revocation
kicks were best effort, and the design only worked with one instance. We
design all of that out here.

## Decision

Every write that others must see appends an `outbox` row **in the same
transaction** as the write. Every realtime instance drains the outbox from
PostgreSQL in commit order and fans rows out to its own local sockets. The
database is the channel: there is no web-to-realtime HTTP call, no shared
secret, no message bus and no Redis pub/sub.

### 1. The outbox row and commit-ordered cursors

```sql
seq     bigserial PRIMARY KEY,
txid    xid8      NOT NULL DEFAULT pg_current_xact_id(),
topic   text      NOT NULL,
kind    text      NOT NULL,
version integer   NOT NULL,
payload jsonb     NOT NULL
```

A position is the pair `(txid, seq)`. A drain reads:

```sql
SELECT … FROM outbox
WHERE (txid, seq) > ($cursorTxid, $cursorSeq)
  AND txid < pg_snapshot_xmin(pg_current_snapshot())
ORDER BY txid, seq
LIMIT 500
```

**Why `seq` alone is wrong.** `bigserial` values are assigned when the row
is inserted, but transactions commit in a different order. Transaction A
inserts `seq = 101`, transaction B inserts `seq = 102`, and B commits first.
A reader that sees 102 and advances its cursor to `seq > 102` never reads
101 when A commits a moment later. The row is skipped permanently, and
nothing downstream can tell.

**Why the `txid` filter is right.** `pg_current_xact_id()` returns the
writing transaction's 64-bit `xid8` id, assigning one if needed; `xid8`
values increase strictly monotonically and are never reused.
`pg_snapshot_xmin(pg_current_snapshot())` is the lowest transaction id
still active; every id below it is finished for everyone, either committed
and visible or rolled back and gone ([PostgreSQL 17, §9.27 system
information functions](https://www.postgresql.org/docs/17/functions-info.html#FUNCTIONS-PG-SNAPSHOT);
[§8.19 `xid8`](https://www.postgresql.org/docs/17/datatype-oid.html)).
A drain therefore only reads rows whose transaction can no longer change,
and it reads them in `(txid, seq)` order. Any row that becomes readable
later belongs to a transaction that was still active at the previous drain,
so its `txid` is at or above that drain's `xmin`, which is above every
position already read. The cursor only moves forward and never passes an
unread row. In the example, neither 101 nor 102 is read until A and B have
both finished, and then both are read.

A rolled-back transaction's rows never exist for any reader, so a
rolled-back write is never delivered.

The cost is latency, not correctness: a long-running writing transaction
holds `xmin` back and delays every later row until it finishes. Writes that
append to the outbox are short command transactions; the availability
sampler's outbox-lag check (plan section H) makes a stall visible.

Clients receive a position as an opaque cursor string. It is an ordering
token, not a secret; the server validates its shape on every use and never
trusts it for authorization.

### 2. Instance startup order

1. `LISTEN outbox` on the dedicated listen connection, and wait for the
   acknowledgement.
2. Read the high-water mark: the greatest `(txid, seq)` whose `txid` is
   below `pg_snapshot_xmin(pg_current_snapshot())`. Set the instance cursor
   to it. Instances hold no history; clients bring their own cursors.
3. Only then accept sockets.

LISTEN comes first so that no commit can fall between the high-water read
and the subscription without producing a wakeup. Sockets come last because
subscribe catch-up (section 4) reads up to the instance cursor, which must
exist first. A process restart repeats all three steps; nothing lives only in
process memory.

### 3. Delivery: the poll is the correctness mechanism

- A single drain loop per instance, never concurrent with itself, reads
  ordered ranges of up to 500 rows until a range comes back short, then fans
  each row out to the local sockets subscribed to its topic. That is one
  range query per wakeup per instance, never one query per event.
- **The drain runs every 1 s, whatever else happens.** That poll is what
  makes delivery correct: every committed row is read within one period plus
  the time its transaction takes to leave the snapshot.
- **NOTIFY only lowers latency.** The append operation calls
  `pg_notify('outbox', position)` in the writing transaction. PostgreSQL
  delivers notifications only when that transaction commits and discards
  them if it rolls back
  ([PostgreSQL 17, `NOTIFY`](https://www.postgresql.org/docs/17/sql-notify.html)),
  so a notification can never announce a rolled-back write. On receipt, an
  instance only sets a `dirty` flag, with the payload as a hint that data
  exists up to at least that position, and the drain loop runs at once
  instead of at the next tick.
- NOTIFY is lossy by design here: PostgreSQL delivers only to connected
  listeners, and a notification sent while the listen connection is down is
  gone. Nothing depends on it, because the drain reads from the cursor, not
  from notifications.
- PostgreSQL holds sent notifications in a shared queue until every
  listener has read them, and a full queue makes `NOTIFY` fail at commit.
  The listen connection therefore never holds a transaction open: Bun
  dedicates it to subscriptions, and Daisy runs no queries on it.
- The poll is not a fallback and must never be described or coded as one.
  There is one delivery path, the drain; NOTIFY is a trigger for running it
  sooner. If NOTIFY's commit-time cost ever matters under contention, LISTEN
  and `pg_notify` are removed outright and the drain keeps its 1 s period.
  No code shape changes, no mode flag exists, and nothing is "kept for now".
- **LISTEN reconnect.** When the listen connection drops and returns, the
  drain runs from the in-memory instance cursor (Bun's `onlisten` callback,
  below).
- Each realtime instance reports its cursor as `deliveredThrough` on its
  `service_instances` lease row, which is how the availability sampler
  measures delivery lag.

**Bun 1.4.2 support, verified against the installed documentation**
(`bun-types@1.4.2`: `sql.d.ts` and `docs/runtime/sql.mdx`, section
"LISTEN / NOTIFY (PostgreSQL)"):

- `sql.listen(channel, onnotify, onlisten?)` resolves once PostgreSQL has
  acknowledged the `LISTEN`, so a notification issued after it resolves is
  delivered. It returns a `ListenSubscription` with `unlisten()` that is
  also an async disposable.
- All subscriptions on one client share one dedicated connection, opened by
  the first `listen()` and closed with the last `unlisten()`.
- If that connection drops, Bun reconnects with exponential backoff (250 ms
  doubling to 32 s, with jitter) and re-subscribes every channel.
  Notifications sent in between are lost. `onlisten` runs on the initial
  subscribe and again after every reconnect, and the documentation names it
  as the place to catch up.
- `sql.notify(channel, payload?)` runs `SELECT pg_notify($1, $2)` on the
  handle it is called through. Inside `sql.begin()` it is delivered on
  commit and dropped on rollback.
- Channel names are quoted by Bun and limited to 63 bytes; payloads are
  limited to 8000 bytes by PostgreSQL's default. A throwing `onnotify` or
  `onlisten` is reported as an uncaught exception and stays subscribed, so
  both callbacks only set flags or schedule the drain.
- LISTEN/NOTIFY is PostgreSQL-only in Bun SQL; on MySQL and SQLite these
  methods reject. Daisy uses only PostgreSQL.

LISTEN is therefore available in the pinned Bun version, and the design uses
it as specified above.

### 4. Client catch-up

`subscribe {topic, since}` on an authorized topic runs in one order:

1. Authorize the topic (the subscribe registry of the realtime service ADR).
2. Record `C`, the instance cursor when the catch-up query starts.
3. Read that topic's rows from PostgreSQL with positions after `since` and
   at or before `C`, and send them.
4. In the same synchronous tick, call `ws.subscribe(topic)` and replay the
   rows for that topic from the drain loop's ring of recently fanned-out
   rows whose positions are after `C`.
5. Reply `subscribed`.

Native Bun topics publish straight to subscribed sockets, so the drain loop
cannot buffer per socket. The ring replaces that buffer: JavaScript runs one
task at a time, so no drain can fan out a row between step 4's replay and
its subscribe. Rows at or before `C` come from PostgreSQL, rows after `C`
come from the ring or, after the subscribe, from live fan-out. There is no
gap and no duplicate; clients also de-duplicate by position.

The server replies `resync_required` instead when:

- `since` is older than retention, or more than N rows behind;
- the ring no longer reaches back to `C`.

The client then refetches the snapshot or version over HTTP and subscribes
from the current position.

### 5. Revocation writers

Revocations are outbox rows, so every instance applies them durably. They
are not best-effort HTTP.

- **`session.revoked`** is appended by Daisy's own session-revocation
  operation (the AUTH-5.5 account security revocation) and by email-change
  completion (the AUTH-5.6 step that revokes every other session once the
  new address is verified). When the operation performs the session delete
  itself, the row is appended in the same transaction. When it delegates the
  delete to Better Auth, whose adapter commits on its own, the row is
  appended once the delete is confirmed.
- **`access.revoked`** is appended by the seat and visibility mutations:
  leaving a seat, removal from a debate, and a debate becoming private. The
  row is written in the mutation's own transaction.
- **Better Auth's internal session deletes** (expiry, sign-out and any path
  that does not pass through Daisy's operation) append nothing. They are
  bounded by the realtime service's 60 s session revalidation: a socket on a
  deleted session is closed at the next revalidation at the latest.

On `session.revoked` an instance closes the matching sockets with the
revoked close code; on `access.revoked` it unsubscribes the actor from the
topic.

### 6. Payload policy

- **Public topics** (`debate:`, `debate::presence`, `standings:`) carry
  doorbells only: ids, `kind` and `version`. Never user content, names or
  text.
- **Owner-only topics** (`user::inbox`) may carry small typed deltas, since
  only the owner can subscribe.
- Clients refetch over HTTP, where permissions are enforced on every read.
  So a subscriber who lost access and is still inside the 60 s
  re-authorization window learns at most that something changed.
- Payloads are Zod schemas in `@daisy/protocol` and every receiver
  `safeParse`s them (ADR 0009 as amended).

### 7. The realtime database role

`apps/realtime` connects as its own PostgreSQL role with exactly these
grants:

- `SELECT` on `outbox` and on the authorization read models it needs to
  authorize subscriptions and revalidate sessions (debates, seats,
  visibility, sessions);
- `INSERT` and `UPDATE` on `service_instances`, for its lease and
  `deliveredThrough`.

Nothing else: no `INSERT` on `outbox`, no `DELETE` or `TRUNCATE` anywhere,
no writes to any other table. Realtime cannot fabricate or erase a delivery.
`apps/web` stays the only writer of competitive state and the only appender
to the outbox.

### 8. Retention

The maintenance sweep prunes outbox rows older than 24 h. A client whose
`since` falls before the retained range gets `resync_required` and reloads
over HTTP; nothing correct depends on an outbox row older than that.

### 9. A delivery log, not event sourcing or a message bus

ADR 0003 rules out event sourcing and a message bus. This design is neither.

- **Not event sourcing.** Competitive state lives in its tables and is
  written by the same commands as before. Outbox rows are notifications
  derived from those writes, written alongside them; state is never rebuilt
  by replaying them, and pruning the whole outbox loses no competitive
  truth. A consumer that misses too much reloads state, not events.
- **Not a message bus.** There is no broker, no second system, no consumer
  groups, acknowledgements or redelivery. It is one table in the PostgreSQL
  that is already the source of truth (ADR 0007), read with an ordinary
  query. The single dependency is the database every service already needs.

## Consequences

- Delivery survives realtime restarts and outages: clients reconnect and
  catch up from their cursor.
- Multi-instance works with no adapter, no Redis pub/sub and no second Redis
  client; each instance drains independently.
- No web-to-realtime secret exists, so there is nothing to sign, rotate,
  replay or lose.
- Each instance issues at least one range query per second; that cost is
  bounded and independent of traffic.
- A long-running writing transaction delays delivery of every later row
  until it finishes, and the outbox-lag health check reports it.
- The outbox, `service_instances` and the realtime role are built by RT-2.2;
  the drain loop, ring and startup order by the `apps/realtime` leaves.
