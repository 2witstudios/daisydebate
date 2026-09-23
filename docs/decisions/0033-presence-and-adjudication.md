# 0033: Presence and adjudication

Status: accepted. Extends [ADR 0008](0008-redis-ephemeral.md) (presence is
Redis state), [ADR 0016](0016-injected-clock-and-identity.md) (time is an
input), [ADR 0029](0029-competitive-schema-foundation.md) (debate outcomes)
and [ADR 0030](0030-effective-rules-and-growth-paths.md) (the effective rules
snapshot). ADR 0031 (the realtime service, RT-1.1) and ADR 0032 (the
outbox, RT-1.2) decide the transport and delivery this ADR builds on.

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
   a secret, and never leaves the server. Every key follows the persistence
   convention:
   - `<namespace>:v1:presence:conn:<connId>`: hash
     `{actorId, activity, instanceId}` with its own TTL.
   - `<namespace>:v1:presence:actor:<actorId>`: sorted set of `connId`
     scored by lease expiry.
   - `<namespace>:v1:presence:online`: sorted set of `actorId` scored by the
     actor's latest lease expiry.
   - `<namespace>:v1:presence:debate:<debateId>:spectators`: sorted set of
     `actorId` scored by lease expiry, built by RT-3.3.

   Every create, refresh and delete is one atomic Lua op in `@daisy/redis`
   (RT-3.1; the spectator set's ops belong to RT-3.3). Every lease score and
   trim uses Redis `TIME` inside the script, so one clock governs hash TTLs
   and sorted-set scores and no instance clock is ever compared with
   another. The actor and online sorted sets carry their own mandatory
   expiry, set in the same script to at least the longest live lease. Every
   read is one Lua op that trims members whose score is in the past, ranges
   and hydrates, and returns the Redis `now` it used, so a caller computing
   `derivePresence`'s `nowMs` never substitutes an instance clock for it.
   **Known gap**: the merged RT-3.1 reads (`readActorConnections` and
   `readOnlinePresence` in `@daisy/redis`) return only the trimmed, hydrated
   rows and do not return `now`; RT-3.1v adds the missing return value
   before any caller is built against these reads. When an instance
   crashes, each of its leases expires on its own; a stale lease can never
   outlive its TTL and poison a result.

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
4. **Doorbells fire on the projected value, and realtime writes nothing.**
   Presence is not in the outbox. Each realtime instance, once per second,
   takes the presence topics it has local subscribers on and does two
   reads for all of them together: one Redis Lua read of their leases, and
   one PostgreSQL read of the seats and `users.presence_visibility` of the
   actors involved. The realtime role may SELECT both. For each topic it
   runs `derivePresence` and then `projectPresence` as a viewer who is not
   the actor, together with the visible counts. It publishes a doorbell to
   its own sockets only when that projected value changes. Because the
   trigger is the projection, an invisible actor connecting, idling or
   leaving rings no doorbell, so nobody can learn their activity from
   timing. Clients refetch the projected value over HTTP from `apps/web`.
   Every instance reads the same Redis and PostgreSQL, so no cross-instance
   message exists, and the realtime role's only write stays
   `service_instances`. The one presence change `apps/web` writes is a
   preference change: it appends an outbox doorbell in the settings
   transaction (RT-3.2b).

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
   column, never a snapshot or client value. The engine receives these
   values as explicit inputs (UTC ISO strings, integer millisecond
   durations) and stays pure.
3. **A check-in commits or aborts within a bound.** The check-in
   transaction is bounded by `transaction_timeout` (PostgreSQL 17+) to
   `checkInCommitBudgetMs` (a protocol constant, 2 000 ms), which must be
   below `finalizationBufferMs` (section 6). So by the time a deadline may
   be finalized, every check-in stamped at or before it has either
   committed or aborted. An aborted check-in never happened; the client
   retries and the retry is stamped anew.
4. **Retries keep their first stamp.** `debate_commands` stays keyed by the
   protocol's cuid2 `commandId` (ADR 0029). Idempotency of check-ins and
   adjudications comes from an added nullable `turn_index` column and a
   unique operation key `(debate_id, type, turn_index, actor_id)`. The key
   applies only to `check-in` and `adjudicate` commands. It is a partial
   unique index `WHERE turn_index IS NOT NULL`, declared
   `NULLS NOT DISTINCT` so that the evaluator's `adjudicate` rows, each
   written under the sweep's service principal rather than an actor
   (section 8), are unique too. A CHECK keeps `turn_index` set for exactly those two
   types. Every other command type (join, ready, transition) has a NULL
   `turn_index`, so the index never sees it and never collides it.
   A retried check-in with a new `commandId` hits the operation key, and
   the handler returns the recorded result and receipt time.
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
- **The window may cross turn boundaries.** A check-in for turn `n` is
  accepted when turn `n` is not yet adjudicated and its effective deadline
  (section 8) has not passed at the receipt time. A deadline that is not
  yet determined has not passed. So when a whole-service outage outlasts a
  turn, both players can still check in for it once service returns. The
  engine guard `recordCheckIn` refuses anything else
  (`debate.check-in.window-open`, section 8), without changing state.
- A check-in for turn `n` stamped before `turnStartedAt(n) - checkInLeadMs`
  (a protocol constant, 5 000 ms) is rejected as early without changing
  state, and the response carries the server time so the client can
  reschedule. A check-in for a completed debate is rejected without
  changing state.
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
is never a loss. Outages extend check-in deadlines (section 8), never the
timetable.

### 6. Rules validation

Three invariants are enforced by the engine's rules validation, which
`createDebateRuntime` and `restoreDebateRuntime` run over the effective
rules, canonical or overridden. Each failure throws `createInvariantError`
with the invariant id. Zod (`formatRulesSchema`) checks only the shape.

- **`debate.rules.check-in-grace-covers-reconnect`**:

  ```text
  checkInGraceMs >= heartbeatMs * 2 + reconnectBudgetMs
  ```

  `heartbeatMs` (15 000) and `reconnectBudgetMs` (10 000) are protocol
  constants in `@daisy/protocol`, next to the heartbeat ADR 0031 defines,
  so the default `checkInGraceMs` is 40 000 ms. `reconnectBudgetMs` is a
  nominal allowance, not a bound ADR 0031's backoff enforces: the backoff
  has no cap and `rate_limited` waits at least 30 s. Since check-ins go
  over HTTP whatever the socket does, the term only sizes the grace
  window.

- **`debate.rules.speech-covers-grace`**: every `speech` turn has
  `durationMs >= checkInGraceMs`, so a speech is never over before its
  speaker could have checked in.
- **`debate.rules.finalization-buffer-covers-commit`**:
  `finalizationBufferMs > checkInCommitBudgetMs`, so no on-time check-in can
  still be in flight when a deadline is finalized (section 8).

### 7. Outages are a three-level state machine

1. **Instance health.** Every web and realtime instance upserts its lease
   row `service_instances {instanceId, role, renewedAt}` every 1 s, stamped
   with database time. The table is built by RT-4.3a. A lease is stale 3 s
   after `renewedAt`. Realtime instances also record `deliveredThrough`,
   their outbox cursor. One instance dying is not an outage while another
   fresh instance of the same role exists, so a rolling restart with a
   healthy peer extends nothing.
2. **Aggregate availability.** One sampler, the web instance holding a
   session-level `pg_try_advisory_lock` (any web instance takes it over on
   its next 1 s attempt), inserts one
   `availability_samples {at, healthy, cause}` row per second. **The insert
   runs on the session that holds the lock**, never on a pooled connection.
   If that session is lost, the lock goes with it and so does any insert
   still in flight, so two samplers can never write at once. The insert
   computes `at`, `healthy` and `cause` in the same statement from database
   time, and also refuses an `at` at or before the latest sample, so
   samples are strictly increasing. `healthy` is true only when:
   - at least one web lease is fresh, so check-ins can be accepted;
   - at least one realtime lease is fresh;
   - some fresh realtime instance's `deliveredThrough` is at or past every
     outbox position whose `created_at` is more than 2 s old. The outbox
     gains `created_at timestamptz NOT NULL DEFAULT statement_timestamp()`
     for this and for its 24 h retention (ADR 0032, RT-2.2). Row age is a
     conservative stand-in for finality: it can only make the sampler
     stricter.

   `cause` names the first failing condition and is null when healthy. A
   single player's own network is never an outage; that is what the grace
   window is for.

   **Accepted risk.** A fresh web lease proves the process is alive, not
   that the public check-in route is reachable. If ingress or the route
   fails while leases keep renewing, samples stay healthy, and a missed
   check-in counts as an absence. The follow-up leaf RT-4.3d adds a
   synthetic check-in probe through the public path as a fourth health
   condition.

3. **Adjudication intervals.** A pure derivation over the ordered samples:
   - An interval opens at the first unhealthy sample, or, for a gap over
     2 000 ms between consecutive samples at `a` and `b`, covers the
     half-open span after `a`: it starts strictly after `a` and never
     includes `a` itself. A late sample under 2 000 ms is not a gap.
   - It closes at the third consecutive healthy sample. Until then it is
     open.
   - Missing evidence counts as an outage: a gap, a sampler that died, or
     history that does not reach back to the window start all favour the
     players. Deadlines are only ever postponed, never shortened.
   - The **settled horizon** is the `at` of the latest sample. Everything at
     or before it is final: a later sample, even one after a gap, only
     affects time strictly after the horizon, so appending samples never
     changes an interval or availability at or before it
     (**`debate.availability.settled-prefix-stable`**, section 8).
   - **Retention**: the maintenance sweep deletes `availability_samples`
     rows whose `at` is older than 24 h and `service_instances` rows whose
     `renewedAt` is older than 24 h. A window whose history was pruned
     counts as outage, never as healthy.

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
4. **Exactly once.** The evaluator records each adjudicated turn in the
   snapshot as `{turnIndex, decision}` (`attended`, `forfeit` or
   `abandoned`). It also writes a `debate_commands` row with type
   `adjudicate` under the sweep's service principal, which the operation
   key (section 3) makes unique per turn, so a retried or concurrent sweep
   records nothing new. It adjudicates a debate's speech turns in order and
   never finalizes turn `n + 1` before turn `n`.
5. **Never reversed.** A finalized decision is never changed, voided or
   recomputed by a later sample, check-in or sweep.

The core invariant, **`debate.adjudication.failure-postpones-only`**: _a
failure can postpone a deadline but never create or erase a loss._ Stated
as a property: for any sample sequence `S`, and any `S'` that holds at
least as much failure evidence (samples marked unhealthy or removed),
every effective deadline under `S'` is at or after the one under `S`, and
every check-in on time under `S` is on time under `S'`. So adding failure
never creates a forfeit, and with the settled prefix fixed and decisions
irreversible, no failure can erase one already decided.

**Registration.** `bun invariants` registers an id only when all three
exist: an engine guard that throws `createInvariantError` with that id, a
negative fixture in `scripts/invariants.ts`, and a `testReference`.
Properties over sequences do not get a property mode in `bun invariants`.
They stay RITEway property tests, and each id's `testReference` points at
its property test. Every id this ADR names:

| Invariant id                                     | Engine guard (module)                                                                                       | State it constrains                                       | Negative fixture                                                                  | Property test (`testReference`)                                               | Leaf    |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------- |
| `debate.rules.check-in-grace-covers-reconnect`   | rules validation in `createDebateRuntime`/`restoreDebateRuntime` (`rules.ts`)                               | effective rules                                           | foundation rules with `checkInGraceMs = 39_999`                                   | `rules.test.ts`                                                               | RT-4.1  |
| `debate.rules.speech-covers-grace`               | same rules validation (`rules.ts`)                                                                          | effective rules' `turns`                                  | a `speech` turn with `durationMs = 39_999` and grace 40 000                       | `rules.test.ts`                                                               | RT-4.1  |
| `debate.rules.finalization-buffer-covers-commit` | same rules validation (`rules.ts`)                                                                          | effective rules                                           | `finalizationBufferMs = checkInCommitBudgetMs`                                    | `rules.test.ts`                                                               | RT-4.1  |
| `debate.availability.settled-prefix-stable`      | `deriveOutageIntervals` refuses samples that are not strictly increasing in `at` (`availability.ts`)        | the sample sequence                                       | two samples with equal `at`                                                       | appending any samples leaves intervals at or before the horizon unchanged     | RT-4.3c |
| `debate.check-in.window-open`                    | `recordCheckIn` (`adjudication.ts`)                                                                         | snapshot attendance                                       | a check-in for an adjudicated turn, and one stamped after its determined deadline | `adjudication.test.ts`                                                        | RT-4.4  |
| `debate.adjudication.failure-postpones-only`     | `adjudicateTurn` refuses to finalize before the settled-horizon gate or with an open interval in the window | adjudication input (turn, attendance, intervals, horizon) | finalize with `settledHorizon = effectiveDeadline + finalizationBufferMs - 1`     | more failure evidence never moves a deadline earlier or makes a check-in late | RT-4.5a |
| `debate.adjudication.finalized-irreversible`     | `applyAdjudication` refuses a turn that already has a decision (`adjudication.ts`)                          | snapshot adjudications                                    | adjudicate an already adjudicated turn again                                      | appending samples after the horizon never changes a finalized decision        | RT-4.5a |
| `debate.adjudication.timestamp-decides`          | `applyAdjudication` refuses a decision that disagrees with the attendance stamps (`adjudication.ts`)        | snapshot attendance and adjudications                     | a forfeit against a speaker whose `receivedAt` is at or before the deadline       | shuffled arrival orders of the same stamps give the same decision             | RT-4.5a |
| `debate.adjudication.speech-turns-only`          | `adjudicateTurn` refuses a non-`speech` turn (`adjudication.ts`)                                            | adjudication input                                        | adjudicate a `prep` turn                                                          | `adjudication.test.ts`                                                        | RT-4.5a |
| `debate.adjudication.last-speech-never-forfeits` | `applyAdjudication` refuses a forfeit on the final `speech` turn (`adjudication.ts`)                        | snapshot adjudications                                    | a forfeit decision for the last speech                                            | `adjudication.test.ts`                                                        | RT-4.5a |

RT-4.5a also proves the lifecycle in `bun scenario disconnect-rejoin`, and
RT-4.5b proves the check-in-versus-evaluator race against real PostgreSQL.

### 9. Turn rules

- **Only speech turns are adjudicated.** The turn kinds come from the
  rules (RT-4.1). Only a `speech` turn is adjudicated, and its `seat` is
  its speaker; other kinds, such as `prep`, are never adjudicated and
  their check-ins are ignored. A missing opponent or judge changes
  nothing.
- **Speaker missing, opponent on time: forfeit.** The debate transitions to
  `completed` with the opponent as winner, `outcome` the opponent's side and
  `outcome_reason = 'forfeit'`, and no judging round. It is rated as a loss
  only when the debate is ranked (ranked already requires canonical rules,
  ADR 0030); casual and practice forfeits never reach `rating_changes`.
- **Both missing: abandoned.** The debate completes with
  `outcome = 'abandoned'` and never rates. This includes the last speech.
- **The last speech never forfeits.** Only the forfeit is exempt. If the
  final speech's speaker is missing and the opponent is on time, the
  speech is simply empty and the debate proceeds to judging. If both are
  missing, the debate is abandoned.
- **A player's drop never pauses the clock** (section 5), and a speaker who
  drops during their own speech has the whole opposing turn to return and
  check in for their next one.
- **The decision depends only on the check-in's timestamp**, never on
  which of a racing check-in and evaluator commits first.

### 10. Where the pure functions live

| Function                                                                                                   | Module                                       | Leaf            | Consumers                                                         |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------- | ----------------------------------------------------------------- |
| `derivePresence`, `projectPresence`, `countVisible`                                                        | `packages/presence/src/index.ts`             | RT-3.2a         | `apps/web` (HTTP reads, top bar), `apps/realtime` (1 s doorbells) |
| rules validation (the three `debate.rules.*` guards)                                                       | `packages/debate-engine/src/rules.ts`        | RT-4.1          | `createDebateRuntime`, `restoreDebateRuntime`                     |
| `turnTimetable`, `turnStartedAt`, `currentTurn`                                                            | `packages/debate-engine/src/timetable.ts`    | RT-4.2          | check-in handler, adjudicator, web client scheduler               |
| `deriveOutageIntervals`, `settledHorizon`                                                                  | `packages/debate-engine/src/availability.ts` | RT-4.3c         | adjudicator, check-in handler                                     |
| `effectiveDeadline`, `recordCheckIn`, `adjudicateTurn`, `applyAdjudication` (attended, forfeit, abandoned) | `packages/debate-engine/src/adjudication.ts` | RT-4.4, RT-4.5a | maintenance evaluator, check-in handler                           |

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
  - _Package-map row_: `packages/presence` · social presence derivation
    and projection · protocol · realtime owner.

  RT-3.2a's criteria carry the package-map row, the `@daisy/presence`
  edges for `apps/web` and `apps/realtime`, and
  `presence: ['protocol']` in `scripts/boundaries-rules.ts`. ADR 0031's
  `apps/realtime` row lists `presence`.

- **Turns, availability and adjudication stay in `@daisy/debate-engine`**
  (ADR 0005). The browser also needs the timetable, to schedule check-ins.
  Per ADR 0024, what the strict CSP breaks is `Database.create` generating
  code with `new Function` at runtime, not the import itself. Even so, the
  client should never bundle `@adobe/data` or be able to reach it. So
  `timetable.ts` imports only `@daisy/protocol` types and is published as
  the subpath export `@daisy/debate-engine/timetable`, which lint already
  allows (only `@daisy/*/src/*` is banned). The root export re-exports it
  for server callers, and `availability.ts` and `adjudication.ts` are root
  exports.
- The web side lives in `apps/web/src/features/attendance/` (check-in route
  operation and the evaluator) and `apps/web/src/features/availability/`
  (instance lease and sampler), each calling focused `@daisy/db`
  operations.

### 11. Durable changes (forward migrations)

Recorded as intent in [persistence](../architecture/persistence.md), in the
single-writer order the plan fixes: outbox with `created_at` (RT-2.2, which
also creates the realtime role), `presence_visibility` (RT-3.2b), rules
(RT-4.1: the `formats.rules` shape CHECK and the foundation seed),
`service_instances` and `availability_samples` (RT-4.3a, RT-4.3b), the
`debate_commands` operation key (RT-4.4), and `outcome_reason` (RT-4.5b).

## Consequences

- A disconnect alone never loses a match, and no outage can create a
  forfeit: the worst a failure does is make a player wait longer for a
  decision.
- Adjudication is late by design: a forfeit is finalized no earlier than
  grace plus the finalization buffer after the turn start, and later still
  during an outage.
- Presence can be wrong for up to a lease TTL after a crash, and that is
  acceptable because nothing competitive reads it.
- A realtime instance's presence re-derivation costs one Redis Lua read and
  one PostgreSQL read (seats and visibility) per second. Each read covers
  all of the instance's subscribed presence topics together, and the
  subscription cap per socket bounds the work.
- The PageSpace record is "Plan — realtime, presence and disconnect rules"
  (sections G and H) in Plans → Realtime and presence.
