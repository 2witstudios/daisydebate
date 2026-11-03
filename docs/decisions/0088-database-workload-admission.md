# 0088: Database workload admission

Status: accepted (platform-capacity slice, G8a of the
[Platform plan](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/hf54ezcwy7d61m9463q20a1i);
[slice plan](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/wgm0p7u42u55700dbkfqqexu)).
Replaces `transaction-admission.ts` and the private Room command counter.

## Context

Only the transcript and round writers were admitted: half of one
10-connection pool, with an unbounded waiter list. Room commands used a
second counter whose refusal was outside the capacity family. Messaging,
the inbox, contacts and every realtime authority read went straight to the
pool. A social or spectator flood could take every connection a Round
needs.

## Decision

1. **Lanes.** PostgreSQL work in a process runs on one of these lanes:
   `competitive`, `social`, `audience`, `browse`, `control` (web), and `admission`,
   `renewal`, `control`, then `headers`, `projection`, `relay` (realtime;
   the last three only on observation-eligible processes, ADR 0089).
   The composition root assigns each operation area its lane. The client
   never chooses a lane.
2. **Non-borrowable by construction.** Each lane has its own Bun SQL pool
   sized to its reservation, so a lane cannot borrow another lane's
   connections.
3. **Counted, aged, fair queues.** Each lane admits up to its connections,
   queues at most `queue` waiters, and refuses a waiter once it is
   `maxWaitMs` old. Waiters are FIFO within a fairness key and round-robin
   across keys. On web the key is the request's client network (an IPv4
   /24, an IPv6 /48, never the address): the ingress runs each request
   inside it, so one network's flood waits its turn behind every other
   network. Work outside a request shares one key. A waiter that does not fit holds its turn, so a bounded
   writer (two connections: work and watchdog) is never starved. A slot is
   held until the work settles, recovery included.
4. **One refusal family.** A refusal is a retryable `INFRASTRUCTURE`
   AppError, recognised by identity through native causes
   (`isCapacityRefusal`) and carrying `{ lane, reason }` where the reason
   is `unconfigured | saturated | expired`. It is logged once as
   `db.capacity.refused`. A route answers a `saturated` or `expired`
   refusal 503 with `Retry-After`, which says asking again can clear it;
   `unconfigured` is the same on every request, so it gets a plain 503.
5. **No reachable raw client.** Areas receive a lane-bound Drizzle handle
   (`$client` included) whose every top-level query, transaction and
   reservation is admitted. The handle is an allowlist: the tagged query,
   `unsafe`, `begin`/`transaction` and `reserve` are admitted, `options`
   is read through for Drizzle, and every other member (LISTEN, NOTIFY,
   close, distributed transactions, anything Bun adds later) is refused;
   `then` and symbol keys are absent, so the handle is not a thenable. Process
   lifetime connections (LISTEN subscriptions, the availability election
   session) are a separate `dedicated` allocation in the profile.
6. **Profiles.** web = competitive 10 (1s wait, the ISSUE-508 wait-out; Room
   preparation, which can wait on external consent inside its transaction,
   takes at most half and refuses excess at once) /
   social 4 / audience 2 / browse 2 / control 10 (queue 4,096, 30s, a backstop only; AUTH-3.10's flood throughput was proven on
   10 connections, so auth bursts
   reach the sign-up ceiling that decides what is shed), plus 1 dedicated (29).
   `audience` holds what a Watch viewer reads: the timeline, chat, reactions, the
   on-air and Live reads, and the link check. It has no queue: a viewer on a full
   lane is refused at once, comes back when told and keeps what it shows, because
   each read is a per-Round cached answer and a queue only delays someone who
   already has one. Nothing a Room, a Round or a host needs reads here, so a crowd
   refuses only itself; those reads run on `competitive`. `browse` holds public
   pages that are not a live audience: standings, profiles and recordings.
   realtime =
   admission 1 / renewal 2 / control 1, plus 3 dedicated (7).
   An `admission` waiter waits 3s, a mitigation for ISSUE-914, whose trigger is
   not established: lane waiter expiry is well supported, but whether a blocked
   read or a burst caused it in CI is not. The wait outlasts one read that
   blocks once to the 2s session lock bound, and a burst, not several blocked
   reads in a row: one participant's fence can still stall every subscribe on
   the process. A refusal logs its pressure (waiters, running, oldest hold), and
   a failed read says `lock_timeout`, `statement_timeout`, `database` or
   `internal`. A hello that reaches its 5s deadline while being checked closes
   retryably (ADR 0031 §8).
   A Round subscribe takes this lane three times, each behind the others in
   flight, inside one 5s budget per authority attempt. A subscribe may make 3
   attempts when writes land mid-read, and its catch-up also reads here outside
   any budget, turning a refusal into a resync. So `n` subscribes at once fit
   while about `n × transaction ms` stays under 1.6s, up to the queue's 100.
   Past that, throughput falls and the lane is spent on subscribes that then
   fail. In a model of 100 at once, the old 250 ms wait accepted 36, 12, 6 and 5
   at 4, 20, 40 and 60 ms a transaction; this wait accepts 100, 23, 0 and 0.
   Budget refusals under repeated fences are an expected outcome here, and
   stopping a check once its budget is spent does not change that. Transaction
   time under load is not measured; locally it is about 4 ms. ISSUE-932 owns
   capacity and blocked reads on this lane.
   realtime-observer adds headers 1 / projection 2 / relay 1 (11). The
   realtime process composes only the reads it serves
   (`createRealtimeDatabase`). Subscribes and their outbox catch-up read on
   `admission`, the outbox drain, health and leases on `control`, and delivery
   re-authorization and revalidation on `renewal`.

## Consequences

- The fleet budget is the sum of profile connections × replicas, plus admin
  and the migrator, kept below `max_connections`
  ([database operations](../operations/database.md)).
- Classifying lock and statement timeouts as retryable is ISSUE-597. The
  real-PostgreSQL proofs (the connection cap under 4x oversubscription and
  competitive p99 under a social flood) are MSG-2.2-arch1-admission2.
