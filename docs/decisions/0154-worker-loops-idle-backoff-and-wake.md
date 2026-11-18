# 0154: Worker loops back off when idle and wake on new work

Status: accepted (point guard brief of 2026-11-18, `staging-noise`, with its
root-cause addendum). Replaces `startSingleFlightWorker` and the hand-rolled
scan intervals in the Round services.

## Context

An idle staging web process polled PostgreSQL about 30 times a second.
Measured locally on the launch stack, origin/main made about 38 lane holds a
second with no Round live. The judging scan ran twice every 250 ms, once per
work kind. Bots, analysis, media recovery and Round and Room maintenance ran
every 250 to 500 ms. About 30 loops ran on three primitives, and none of
them read its own result. The lane telemetry then turned every poll into log
lines: 682 a minute on staging, 681 locally. While a process was stalled, a
loop retried every tick and filled Sentry with deadline-expired errors
(DAISY-WEB-1 and -4, thousands of events).

## Decision

1. **One primitive.** Every polling background worker runs on
   `startWorkerLoop` (`apps/web/src/lib/worker-loop.ts`). It runs one pass
   at a time in each process: it runs a pass at once, then again after a
   wait. A pass reports `worked` or `idle`. A thrown pass is reported and
   counts as `failed`.
2. **Pure idle back-off.** `nextWaitMs` (`idle-backoff.ts`) sets the wait
   before the next pass:
   - `busyMs`, the worker's old interval, after a pass that found work;
   - double the last wait after an empty or failed pass, up to `idleMaxMs`.

   The caps are 10 s for loops on a live Round's path (judging, bots, Round
   and Room maintenance, media recovery, Broadcast and recording capture)
   and 60 s for housekeeping. Room maintenance gets no wake (its work, a
   Room idle past the timeout, is made by the clock, not a command), so its
   cap alone bounds it. A loop with a fixed cadence (billing economics
   hourly, the cleanup monitor each minute) sets the cap equal to `busyMs`.

3. **What counts as work.** A live-Round loop reports `worked` while
   anything is live, queued or due: a held claim, an owned seat, a
   discovered Round, an open capture. Its clock deadlines then keep the busy
   pace, and the loop backs off only when Daisy is idle. The availability
   probe's Round never counts.
4. **Wake signal.** A command that creates work runs
   `pg_notify('daisy_work', kind)` in its own transaction. PostgreSQL
   delivers it only on commit.

   | Kind       | Sent when                                    |
   | ---------- | -------------------------------------------- |
   | `judging`  | a judging job is inserted                    |
   | `round`    | a Round is created, and on every Round write |
   | `analysis` | an analysis is requested                     |

   The web process LISTENs on one more dedicated connection
   (`WORKLOAD_PROFILES.web.dedicated` goes from 1 to 2). A wake resets the
   back-off of the loops for that kind and brings their next pass forward,
   never sooner than `busyMs` after the last pass started. Wakes in between
   coalesce into that one pass, so however often Rounds are written, the
   busy interval stays a rate ceiling. When the LISTEN is established or
   re-established, every loop is woken once.

5. **Wakes are lossy.** A wake is a hint: it grants nothing and carries no
   row. A lost wake costs at most the loop's idle cap. If the LISTEN cannot
   start, the process logs `worker.wake.unavailable` and every loop still
   runs.
6. **Not polls.** Availability's one-second lease renewal and health sample
   is per-second evidence by contract (one `availability_samples` row a second, ADR 0033), so it keeps its cadence.
   Lease renewals for held claims, and the hourly or minute schedules on
   `startRunSchedule`, are heartbeats, not discovery.

## Consequences

- An idle process makes a few DB statements a second instead of about 30,
  and live work is claimed within one busy interval of being created.
- A failing store is retried at a growing interval instead of every tick, so
  an outage reports a bounded number of failures.
- The lane gauges log one window a minute per lane. A per-operation line
  appears only when the operation queued for the lane, held it for 1 s or
  more, or `LOG_LEVEL` is `debug` (the floor run sets it).
- A new polling worker uses `startWorkerLoop`, reports `worked` or `idle`
  honestly, and states its cap. If its work is created by a command, that
  command sends a work kind.
