# 0033: Presence and adjudication

Status: accepted. Extends [ADR 0008](0008-redis-ephemeral.md) (presence is
Redis state), [ADR 0016](0016-injected-clock-and-identity.md) (time is an
input), [ADR 0029](0029-competitive-schema-foundation.md) (debate outcomes)
and [ADR 0030](0030-effective-rules-and-growth-paths.md) (the effective rules
snapshot). The realtime service ADR (RT-1.1) and the outbox ADR (RT-1.2)
decide the transport and delivery this ADR builds on.

## Context

Live play needs two things that look alike and must never be confused:

- **Social presence**: who is online, away or in a debate, and how many
  people are watching. It is advisory, lossy and cheap to be wrong about.
- **Competitive attendance**: whether a debater was there when their turn
  started. It decides forfeits and abandonments, so it must be durable,
  deterministic and immune to anything we run going wrong.

The owner's rules are that a disconnect is never an automatic loss, nothing
may be flaky, and a player may be invisible. The failure we design out is
the one that punishes a player for our outage, or that reverses a result
after it was announced. This ADR records the model for both halves, the one
clock, the outage state machine, the deadline rules, and where each pure
function lives, so the presence (RT-3), turn (RT-4.1, RT-4.2), availability
(RT-4.3) and adjudication (RT-4.4, RT-4.5) leaves can start without
guessing.

## Decision

### 1. Social presence is advisory and lives in Redis leases

1. **One lease per connection, never one field per actor.** Each socket
   owns a lease the realtime instance holding it creates on `hello`,
   refreshes every 20 s with a 60 s TTL, and deletes on a clean close. The
   connection id is a cuid2 the instance mints; it is an identifier, never
   a secret, and never leaves the server. Keys follow the persistence
   convention (`<namespace>:v1:<segment>`):
   - `presence:conn:<connId>`: hash `{actorId, activity, instanceId}` with
     its own TTL.
   - `presence:actor:<actorId>`: sorted set of `connId` scored by lease
     expiry.
   - `presence:online`: sorted set of `actorId` scored by the actor's latest
     lease expiry.
   - `presence:debate:<debateId>:spectators`: sorted set of `actorId` scored
     by lease expiry.

   Every create, refresh, delete and read is one atomic Lua op in
   `@daisy/redis` (RT-3.1). Reads trim members whose score is in the past.
   Scores and the `now` a read returns come from Redis `TIME` inside the
   script, so no instance clock is ever compared with another. When an
   instance crashes, each of its leases expires on its own; a stale lease
   can never outlive its TTL and poison a result.

2. **Activity and visibility are separate axes.**
   - `activity: active | idle` belongs to a connection. The client reports
     it with `presence.activity`: `idle` when the tab is hidden or there has
     been no input for 5 minutes, otherwise `active`.
   - `visibility: visible | invisible` belongs to the account. It is a
     durable privacy preference in PostgreSQL (`users.presence_visibility`,
     RT-3.2b), written only by the settings operation. It is never written
     to a Redis field, and no code treats `invisible` as `idle` or `idle` as
     `invisible`.
   - `inDebate` comes from PostgreSQL seats (`debate_participants` of an
     `active` debate), never from the client.
3. **Status is derived in two pure steps.**
   - `derivePresence({ leases, seats }, nowMs)` returns the internal state:
     `connected` (at least one unexpired lease), `activity` (`active` if any
     unexpired lease is active, otherwise `idle`) and `inDebate` (the
     actor's seats in active debates, each with the debate's visibility).
     It knows nothing about privacy.
   - `projectPresence(internal, visibility, viewer)` returns the public
     `in-debate | online | away | offline` a given viewer may see. An
     invisible actor is `offline` to everyone but themself, except that a
     viewer of a public debate sees the actor's seat in that debate. For a
     visible actor the order is `in-debate`, then `online` (active), then
     `away` (idle), then `offline`.
   - Aggregate counts (online users, spectators) count only projected
     visible actors, so invisible actors are excluded from every count.
   - No projected value or broadcast ever carries a connection id, an
     instance id or another user's activity detail beyond the status.
4. **Delivery needs no writes from realtime.** Presence is not in the
   outbox. Each realtime instance re-derives presence every 1 s for the
   presence topics it has local subscribers on, reading the shared Redis
   state, and publishes a doorbell to its own sockets when the derived value
   changes; clients refetch the projected value over HTTP from `apps/web`,
   where visibility is applied. Every instance reads the same Redis, so no
   cross-instance message exists and the realtime database role stays
   SELECT-only apart from `service_instances`. A preference change is the
   one presence change `apps/web` writes: it appends an outbox doorbell in
   the settings transaction (RT-3.2b).

### 2. Competitive outcomes read durable commands only

Attendance, forfeit, abandonment and every other competitive outcome are
decided from PostgreSQL rows written by durable, idempotent HTTP commands
and from the availability samples below. They never read Redis, socket
state, presence, or any instance's memory. A player who is shown as
`online` can still forfeit, and one shown as `offline` can still be on
time. The check-in and adjudication operations
(`apps/web/src/features/attendance/`) do not import `@daisy/redis`; the
leaf that adds them (RT-4.4) adds a lint rule that fails if they do.

### 3. One clock: PostgreSQL receipt time

1. **A check-in counts at its database receipt time**: the
   `statement_timestamp()` of the first statement of the check-in
   transaction, taken before the debate row lock is requested, so waiting
   on the lock can never make a check-in late. Not the client's clock, not
   the web instance's clock, and not the time the engine processed it.
2. **Every competitive time uses the same clock**: debate start
   (`debates.started_at`), check-in receipts, `service_instances` renewals
   and availability samples are all PostgreSQL time. Today `saveSnapshot`
   stamps `started_at` from the caller's `updatedAt`, an application clock;
   the save that activates a debate must stamp it with
   `statement_timestamp()` instead (RT-4.2), and the timetable reads that
   column, never a snapshot or client value. The engine receives
   these values as explicit inputs (UTC ISO strings, integer millisecond
   durations) and stays pure.
3. **A check-in commits or aborts within a bound.** The check-in
   transaction is bounded by `transaction_timeout` (PostgreSQL 17+) to
   `checkInCommitBudgetMs` (a protocol constant, 2 000 ms), which must be
   below `finalizationBufferMs` (section 6).
   So by the time a deadline may be finalized, every check-in stamped at or
   before it has either committed or aborted. An aborted check-in never
   happened; the client retries and the retry is stamped anew.
4. **Retries keep their first stamp.** The check-in command key is
   `check-in:<debateId>:<turnIndex>:<actorId>` in `debate_commands`; a
   retry after a commit replays the recorded result and receipt time.
5. **The check-in is recorded in the debate snapshot** as an attendance
   entry `{turnIndex, participantId, receivedAt}`, so the snapshot stays
   the domain source of truth and adjudication is a pure function of it.
   No separate check-in table exists.

### 4. Check-ins never depend on the socket

- Every seated client computes the turn timetable (section 5) from the
  durable debate start and the effective rules, and sends
  `debate.check-in {turnIndex}` over HTTP to `apps/web` at each turn start,
  whether or not its socket is up. The socket only makes the client learn
  of the start sooner.
- The client estimates its offset from the server receipt times the
  check-in responses return; it never trusts its own clock for the
  deadline.
- A check-in for turn `n` stamped before `turnStartedAt(n) - checkInLeadMs`
  (a protocol constant, 5 000 ms) is rejected as early without changing
  state, and the response carries the server time so the client can
  reschedule. A check-in for a turn that is not the current or the next
  turn, or for a completed debate, is rejected without changing state.
- Every seated client checks in; only the turn's speaker is penalised for
  missing it. The opponent's check-in for the same turn decides forfeit
  versus abandonment. Judges' check-ins never affect adjudication.

### 5. Turn boundaries are computed, never persisted

`turnStartedAt(n) = startedAt + sum(durationMs of turns 0..n-1)` over the
`turns` of the effective rules (RT-4.1). One pure engine function computes
the whole timetable (every turn's start, the current turn and the remaining
time for an instant), and both the check-in handler and the adjudicator call
it. No per-turn row exists, so none can drift out of step with the rules.

**The clock never pauses.** Not for a player's drop, not for a reconnect,
not for an outage. A speaker who drops mid-speech keeps the floor if they
return before the turn ends; otherwise the speech ends short, and that alone
is never a loss. Outages extend check-in deadlines (section 7), never the
timetable.

### 6. Grace covers detection and reconnection

The rules validation invariant
**`debate.rules.check-in-grace-covers-reconnect`**:

```text
checkInGraceMs >= heartbeatMs * 2 + reconnectBudgetMs
```

`heartbeatMs` (15 000) and `reconnectBudgetMs` (10 000) are protocol
constants owned by `@daisy/protocol` next to the heartbeat the realtime ADR
defines, so the default `checkInGraceMs` is 40 000 ms. `formatRulesSchema`
rejects any rules below it, canonical or overridden, and RT-4.1 registers
the invariant in `spec/invariants.json` with a negative fixture.

The same validation enforces
**`debate.rules.finalization-buffer-covers-commit`**:
`finalizationBufferMs > checkInCommitBudgetMs`, so no on-time check-in can
still be in flight when a deadline is finalized (section 8).

### 7. Outages are a three-level state machine

1. **Instance health.** Every web and realtime instance upserts its lease
   row `service_instances {instanceId, role, renewedAt}` every 1 s, stamped
   with database time. A lease is stale 3 s after `renewedAt`. Realtime
   instances also record `deliveredThrough`, their outbox cursor. One
   instance dying is not an outage while another fresh instance of the same
   role exists, so a rolling restart with a healthy peer extends nothing.
2. **Aggregate availability.** One sampler, the web instance holding a
   session-level `pg_try_advisory_lock` on its dedicated connection (any web
   instance takes it over on its next 1 s attempt), inserts one
   `availability_samples {at, healthy, cause}` row per second. The insert
   computes `at`, `healthy` and `cause` in the same statement from database
   time, and refuses an `at` at or before the latest sample, so samples are
   strictly increasing. `healthy` is true only when:
   - at least one web lease is fresh, so check-ins can be accepted;
   - at least one realtime lease is fresh;
   - some fresh realtime instance's `deliveredThrough` is at or past every
     outbox position whose row is older than 2 s (row age is a
     conservative stand-in for finality: it can only make the sampler
     stricter).

   `cause` names the first failing condition and is null when healthy. A
   single player's own network is never an outage; that is what the grace
   window is for.

3. **Adjudication intervals.** A pure derivation over the ordered samples:
   - An interval opens at the first unhealthy sample, or at the earlier
     sample of the first gap over 2 000 ms between consecutive samples. A
     late sample under 2 000 ms is not a gap.
   - It closes at the third consecutive healthy sample. Until then it is
     open.
   - Missing evidence counts as an outage: a gap, a sampler that died, or
     history that does not reach back to the window start all favour the
     players. Deadlines are only ever postponed, never shortened.
   - The **settled horizon** is the `at` of the latest sample. Everything at
     or before it is final: appending later samples never changes an
     interval or availability at or before the horizon (invariant
     **`debate.availability.settled-prefix-stable`**).
   - **Retention**: the maintenance sweep deletes samples and
     `service_instances` rows whose `renewedAt` is older than 24 h. A window
     whose history was pruned counts as outage, never as healthy.

### 8. Deadlines are adjudicated exactly once

1. **Effective deadline.** For turn `n`, the effective deadline is the
   instant at which `checkInGraceMs` of non-outage time has elapsed since
   `turnStartedAt(n)`; equivalently `turnStartedAt(n) + checkInGraceMs +`
   the outage time overlapping that window. It is undetermined while an
   open interval, or time after the settled horizon, falls inside it.
2. **Settled-horizon gate.** The evaluator (the maintenance sweep) may
   finalize turn `n` only when the deadline is determined and
   `settledHorizon >= effectiveDeadline + finalizationBufferMs` (a rules
   field, 5 000 ms by default, above `checkInCommitBudgetMs`). By then no
   unrecorded outage can fall inside the window, and every on-time
   check-in has committed or aborted (section 3). The evaluator never reads
   its own clock.
3. **Timestamps decide, not transaction order.** Check-ins and the evaluator
   serialize on the debate row (`SELECT … FOR UPDATE` plus the optimistic
   `version`). A check-in stamped at or before the effective deadline is on
   time; one stamped after it is late. Once an outcome is finalized the
   debate is terminal and later check-ins are rejected without changing
   state.
4. **Exactly once.** The evaluator's command key is
   `adjudicate:<debateId>:<turnIndex>` in `debate_commands`, under the
   sweep's service principal, so a retried or concurrent sweep records
   nothing new. It adjudicates a debate's turns in order and never
   finalizes turn `n + 1` before turn `n`. A turn whose speaker was on time
   needs no record: the attendance entry is the evidence.
5. **Never reversed.** A finalized outcome is never changed, voided or
   recomputed by a later sample, check-in or sweep.

The core invariant, **`debate.adjudication.failure-postpones-only`**: _a
failure can postpone a deadline but never create or erase a loss._ As a
testable property over the pure functions: for any sample sequence `S` and
any `S'` that holds at least as much failure evidence (samples marked
unhealthy or removed), every effective deadline under `S'` is at or after
the one under `S`, and every check-in on time under `S` is on time under
`S'`, so adding failure never creates a forfeit. Together with
**`debate.adjudication.finalized-irreversible`** (appending samples after the
horizon never changes a finalized turn's decision) and
`debate.availability.settled-prefix-stable`, no failure can erase a loss
already decided. RT-4.5a registers these in `spec/invariants.json` with
negative fixtures and proves them in `bun scenario disconnect-rejoin`.

### 9. Turn rules

- **Only the speaker's absence is penalised.** The turn's `seat` is its
  speaker; a missing opponent or judge changes nothing.
- **Speaker missing, opponent on time: forfeit.** The debate transitions to
  `completed` with the opponent as winner, `outcome` the opponent's side and
  `outcome_reason = 'forfeit'`, and no judging round. It is rated as a loss
  only when the debate is ranked (ranked already requires canonical rules,
  ADR 0030); casual and practice forfeits never reach `rating_changes`.
- **Both missing: abandoned.** The debate completes with `outcome =
'abandoned'` and never rates.
- **The last speech never forfeits** (invariant
  **`debate.adjudication.last-speech-never-forfeits`**). The final `speech`
  turn is not adjudicated at all: a missing speaker's speech is simply
  empty, and the debate proceeds to judging.
- **A player's drop never pauses the clock** (section 5), and a speaker who
  drops during their own speech has the whole opposing turn to return and
  check in for their next one.
- **The decision depends only on the check-in's timestamp**
  (**`debate.adjudication.timestamp-decides`**), never on which of a racing
  check-in and evaluator commits first.

### 10. Where the pure functions live

| Function                                                                           | Module                                       | Leaf    | Consumers                                                             |
| ---------------------------------------------------------------------------------- | -------------------------------------------- | ------- | --------------------------------------------------------------------- |
| `derivePresence`, `projectPresence`, `countVisible`                                | `packages/presence/src/index.ts`             | RT-3.2a | `apps/web` (HTTP reads, top bar), `apps/realtime` (1 s re-derivation) |
| `turnTimetable`, `turnStartedAt`, `currentTurn`                                    | `packages/debate-engine/src/timetable.ts`    | RT-4.2  | check-in handler, adjudicator, web client scheduler                   |
| `deriveOutageIntervals`, `settledHorizon`                                          | `packages/debate-engine/src/availability.ts` | RT-4.3c | adjudicator                                                           |
| `effectiveDeadline`, `adjudicateTurn` (forfeit, abandon or nothing, horizon-gated) | `packages/debate-engine/src/adjudication.ts` | RT-4.5a | maintenance evaluator, check-in handler                               |

- **`@daisy/presence` is a new package** (`packages/presence`), because two
  real consumers (`apps/web` and `apps/realtime`) run the same derivation
  and neither may import the other. It satisfies the new-package rule:
  - _Responsibility_: pure derivation and projection of social presence
    from leases, seats, visibility and a viewer; no I/O, no clock, no
    Redis.
  - _Owner_: the realtime owner.
  - _Exports_: `.` → `src/index.ts` only (`derivePresence`,
    `projectPresence`, `countVisible` and their input types).
  - _Allowed dependencies_: `@daisy/protocol` only, for the
    `presenceStatuses`, `presenceActivities` and `presenceVisibilities`
    vocabularies that cross the wire (added to `@daisy/protocol` by
    RT-3.2a).
  - _Tests_: RITEway `src/index.test.ts` with fixed `nowMs`, run by
    `bun test`.
  - _Package-map row_ (added by RT-3.2a with the package, together with the
    `scripts/check-boundaries.ts` allowlist): `packages/presence` · social
    presence derivation and projection · protocol · realtime owner.

  RT-1.1's package map therefore changes: it gains the `packages/presence`
  row, and both `apps/web` and `apps/realtime` gain `@daisy/presence` in
  their allowed edges.

- **Turns, availability and adjudication stay in `@daisy/debate-engine`**
  (ADR 0005). The timetable is also needed in the browser to schedule
  check-ins, and the engine root imports the Adobe ECS adapter, which the
  strict CSP forbids on the client (ADR 0024). So `timetable.ts` imports
  only `@daisy/protocol` types and is published as a subpath export
  `@daisy/debate-engine/timetable`; the root export re-exports it for server
  callers. `availability.ts` and `adjudication.ts` are root exports.
- The web side lives in `apps/web/src/features/attendance/` (check-in route
  operation and the evaluator) and `apps/web/src/features/availability/`
  (instance lease and sampler), each calling focused `@daisy/db`
  operations.

### 11. Durable changes (forward migrations)

Recorded as intent in [persistence](../architecture/persistence.md), in the
single-writer order the plan fixes: outbox (RT-2.2), `presence_visibility`
(RT-3.2b), rules (RT-4.1: the `formats.rules` shape CHECK and the foundation seed), `service_instances` and
`availability_samples` (RT-4.3a, RT-4.3b), `outcome_reason` (RT-4.5b).

## Consequences

- A disconnect alone never loses a match, and no outage can create a
  forfeit: the worst a failure does is make a player wait longer for a
  decision.
- Adjudication is late by design: a forfeit is finalized no earlier than
  grace plus the finalization buffer after the turn start, and later still
  during an outage.
- Presence can be wrong for up to a lease TTL after a crash, and that is
  acceptable because nothing competitive reads it.
- A realtime instance's presence re-derivation costs one Redis read per
  locally subscribed presence topic per second; the subscription cap per
  socket bounds it.
- The PageSpace record is "Plan — realtime, presence and disconnect rules"
  (sections G and H) in Plans → Realtime and presence.
