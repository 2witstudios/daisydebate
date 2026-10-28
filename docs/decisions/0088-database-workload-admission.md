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
   `competitive`, `social`, `audience`, `control` (web), and `admission`,
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
   `db.capacity.refused`.
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
   social 4 / audience 2 / control 10 (queue 4,096, 30s, a backstop only; AUTH-3.10's flood throughput was proven on
   10 connections, so auth bursts
   reach the sign-up ceiling that decides what is shed), plus 1 dedicated (27). realtime =
   admission 1 / renewal 2 / control 1, plus 3 dedicated (7).
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
