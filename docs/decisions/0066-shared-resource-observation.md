# 0066: Shared resource observation

Status: proposed for main acceptance with the realtime observation cutover
(RT-2.3c-arch1, RT-2.5c-arch1, RT-2.6a-arch1, MSG-5.3-arch1). Supersedes
[ADR 0032](0032-transactional-outbox-delivery.md) §§3–4 and §6, and its
"no Redis pub/sub" and per-instance drain rules. Amends
[ADR 0031](0031-realtime-service.md) (the socket carries bounded protected
snapshots, not only doorbells) and [ADR 0008](0008-redis-ephemeral.md)
(Redis holds expendable protected snapshot bodies).

## Context

ADR 0032 made every realtime instance drain the outbox and ring a
content-free doorbell; each browser then refetched over HTTP. That multiplies
PostgreSQL work by observers: every doorbell becomes one authorization and one
projection query per watching tab, every instance repeats the drain, and the
drain's `pg_snapshot_xmin` horizon stalls behind any unrelated open
transaction. Recovery was replay positions, rings and `resync_required`, which
the client had to orchestrate alongside router refreshes that replaced drafts.
The [architecture repair plan](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/b8yv71h2bc9pbfmbgsm2n2pe)
§4 replaces this with shared bounded snapshots.

## Decision

### 1. Build once per resource, distribute through Redis

A bounded eligible subset of realtime processes (those holding
`OBSERVATION_DATABASE_URL`, a separate pool on the narrow `daisy_projection`
role) owns resource reconciliation. Per active resource one owner, claimed
in Redis with a token, a cache incarnation and a 2s lease renewed only by
useful progress, reads indexed durable headers every 100ms and builds a
changed projection once per base and content revision through the owning
protocol mapper. Fanout-only processes never read headers or projections.

Body installation and head advancement are one guarded Redis script scoped to
one resource: current owner, incarnation, purge generation and disclosure
revision must all match. A small metadata hint follows on Redis Pub/Sub; hints
are at-most-once, and every node repairs from Redis heads every 500ms, so a
lost hint delays but never loses progress. Missing bodies re-arm shared
demand; nodes never fall back to per-viewer PostgreSQL.

### 2. Identities

A projection base is resource, policy-issued visibility partition, durable
disclosure revision and normalized window. A body is a base plus a content
revision. Authorization evidence is separate and never part of a cache key;
renewing evidence never rebuilds a body and reusing a body never extends
evidence.

### 3. Subscription permits

Sockets send `observe`/`unobserve` with a resource and window. Admission and
renewal are canonical PostgreSQL reads on the realtime pool (admission 1,
renewal 2), batched and bounded: 100 waiting admissions with a 250ms age,
256-binding renewal batches over two lanes. Subject, cohort and entitlement
evidence expire independently, at most 4700ms after the read's original start
(5s less a 300ms reserve for clock-envelope edges and enqueue settlement).
Every enqueue checks the permit synchronously. Infrastructure failure is
`unavailable`, never denial; denial ends the binding.

The selected revocation contract is bounded with immediate push: a committed
revocation stops protected enqueue within 5s, and an observed control fences
sooner. Bytes already sent cannot be recalled.

### 4. One fleet metadata relay

One eligible process at a time claims the relay, reads finalized outbox
metadata in 256-row batches and publishes control fences (today
`session.revoked`) on one Redis channel, advancing a compare-and-set cursor
only after publication. A missing cursor restarts at the finalized position.
Content progress and permit bounds never depend on the relay; it only stops
enqueue sooner.

### 5. Wire and browser

`observation.ready` carries the base, the minimum content revision and the
permit's remaining validity; `observation.snapshot` carries one bounded
replacement body (128KiB frame, 96KiB of rows, 50 items, continuation after
the last complete item); `observation.state` reports `denied`, `unavailable`
or `degraded`. There are no replay positions. One provider per tab owns the
socket, reference counts, deadlines and disposal; features supply a descriptor
and render the current view. Drafts and forms live outside replaceable views.
Commands and no-JavaScript rendering stay HTTP.

### 6. Actor-private overlays and their budget

A canonical admission or renewal may return a small actor-private overlay
(today the viewer's own reactions in the channel window). It travels on
`observation.ready` only when it changed for that request generation; an
omitted overlay means unchanged, so steady renewals cost no overlay egress.
Bounds: the channel overlay schema allows at most 400 own reactions of at
most 16 UTF-16 units, which fits the 64KiB per-binding overlay limit (asserted
when the protocol loads); web composition refuses a reaction policy with more
than 8 choices or longer reactions, so the current policy alone cannot produce
an out-of-schema overlay. Own reactions retained from an earlier, broader
policy stay removable and can still exceed the schema; that overlay degrades
to none (own reactions then show unflagged until they fit again) rather than
failing delivery. Each node retains at most 32MiB of overlays across its
bindings (5,000 bindings at the typical few hundred bytes each use well under
it); past the budget, or past the per-binding limit, an overlay degrades to
none while shared delivery continues.

### 7. Privacy

Snapshot bodies are personal or sensitive data in transit and in Redis. Redis
holds them under namespaced keys for at most 60s, with explicit purge fences
for erasure; bodies never enter logs, metrics, URLs or the metadata-only
outbox. See [privacy](../operations/privacy.md).

## Consequences

PostgreSQL content work grows with distinct resources and variants, not
observers or fanout nodes; authority work grows with distinct bindings and is
budgeted separately. Redis becomes part of protected delivery and must stay
inside the deployment's trust boundary. The outbox remains the durable,
transactional metadata log; `pg_notify` and outbox LISTEN go away with the
cutover. Resources adopt observation only when their producer and consumer are
both ready; until then they keep their existing read path, and no adopted
resource keeps a second recovery path.
