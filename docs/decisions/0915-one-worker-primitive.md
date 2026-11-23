# 0915: One primitive for background loops, leases and shutdown

Status: accepted (owner, 2026-11-19: "execute it all" on Plan — reconcile,
step R4.7). Amends [ADR 0154](0154-worker-loops-idle-backoff-and-wake.md)
(its loop moves into the package; its semantics are unchanged) and
[ADR 0164](0164-property-tests-and-virtual-time.md) (production waits on the
same injected time the tests drive).

## Context

Measured on main at `334bbc8ac`: 148 server-side timer sites in seven
shapes, about twenty of them hand-written loops in four shapes (poll with
back-off, while-not-stopped claim and sleep, lease renewal, fixed interval)
across web and seven worker apps. Ten periodic renewers, each written by
hand, with four cancellation conventions (an `AbortSignal`, a `stopped`
flag, a `stop()` promise, a bare interval handle). Two web probes were
intervals nothing could stop; three worker apps slept in waits a shutdown
could not interrupt; the audience publisher hung on SIGTERM while a store
read was stuck. A host-time rule finds 93 reads of host time in 51
server source files.

## Decision

1. **`@daisy/clock` owns the time port.** `Waits` (`nowMs`, `sleep`,
   `waitUntilMs`; a wait resolves when due or at once on abort, never
   rejects) and, over it, `deadlineSignal` and `afterMs`.
   `virtualClock` is a `Waits`. A deadline or one-shot fires only once the
   clock reaches it.
2. **`@daisy/worker` owns a background worker's loop, lease and shutdown.**
   `pollWork` (ADR 0154's loop), `repeatEvery` (a fixed cadence: single
   flight, a run due while one is going is skipped), `holdLease`, `stopAll`
   (stop every worker, bounded); a failure sink that throws is contained. Every worker stops through one `AbortSignal`: a wait ends at
   once, the work in flight receives the signal, and `stop()` resolves when
   that work has ended.
3. **One lease contract for exclusive job leases.** The fence stays the
   store's: `renew` closes over it. A renewal is `held` (with the store's
   facts) or `lost` (`taken`, `released`, `expired`); a store that refuses by
   throwing maps the refusal through `lossOf`, so a CONFLICT that means
   completion is `released`. Any other throw is a blip, retried until the
   horizon after the start of the last renewal that held; past it the lease
   has `expired`, even with a renewal in flight. `guard(write)` refuses a
   write once the lease has ended. Liveness heartbeats (the realtime and
   web service leases, presence), the observation owner (claim and renewal
   are one call, with a voluntary `idle`) and observation permits
   (authorization, not ownership) are not exclusive leases: they are
   `repeatEvery` cadences.
4. **Host time lives in one module.** `@daisy/worker/host` (`hostWaits`) is
   the only server module that reads host timers; process entries pass it
   in. `daisy-time/host-time` (`eslint.config-host-time.mjs`) refuses every
   other spelling in `apps/*/src` and `packages/*/src`: a timer global read
   under any name, a host object read other than as a harmless static
   member, `Bun.sleep`, `AbortSignal.timeout`, `Atomics.wait`, the `timers`
   modules and `sleep` from `bun`. Browser files are the client edge's.
   Tests and integration suites are outside it (ADR 0164 governs unit tests).

## Consequences

- A blip no longer counts as a renewal forever (recording, judging, bots)
  and no longer counts as a loss (transcription recovery): both meet the
  horizon. Media capture keeps its outage budget as its horizon.
- Worker processes stay alive while work is scheduled (host waits are no
  longer unref'd) and exit through `stopAll`, bounded within their grace.
- Polling slots that polled at a fixed rate (broadcast and recording
  workers) back off when idle.
