# 0164: Property tests and virtual time

Status: accepted (owner, 2026-11-19: "execute it all" on Plan — reconcile,
step R1.2).

## Context

Measured on 19 November 2026 at `417ad45a0`:

- No property-testing library. Three suites carried their own seeded
  generator: two linear congruential generators
  (`round-media/model/reduce-media-invariants.test.ts`,
  `messaging/context-chat/reduce-chat-invariants.test.ts`) and a hash stream
  (`packages/tab-engine/src/breaks/break-properties.test.ts`). None shrank a
  failure: each reported a seed and a trace of up to 120 events.
- A fourth suite (`round-bots/peer-line.test.ts`) carried its own virtual
  clock.
- Unit tests waited on real time: the rule below finds 74 timed waits in 22
  files. The bot publisher's suite slept 45 times and asserted real-time
  tolerances, and the capture outage suite slept through a real outage, though both modules
  already take their clock as a resource.
- The round engine, the next rewrite (R4.1), had 25 registered invariants
  and no test that generated its inputs.

## Decision

1. **fast-check is the one property-testing library**, a devDependency only.
   No second generator, hand-rolled or library.
2. **Every property run is seeded.** `@daisy/seeded-random/testing` is the
   one helper: `seededCheck` (an arbitrary and its problems), `seededDraws`
   and `seededAsyncDraws` (an input built from a tape of draws, including
   async public operations) and `seededWalk` (a walk over the
   moves each state allows). Each takes a fixed seed and a run count, so a
   run never varies, and reports the shrunk failure as text a RITEway
   assertion compares with `null`.
3. **Unit tests run on virtual time.** `@daisy/clock/testing` exports
   `virtualClock`, the one monotonic clock a test owns: `nowMs`, `sleep`,
   `waitUntilMs`, `advance` and `run`. Timed code takes these as resources,
   as the engineering rules already require.
4. **A real sleep in a unit test is a lint error** (`test-time/no-real-sleep`
   on `*.test.ts(x)` and `*.test-support.ts(x)` outside `integration/` and
   `e2e/`): `Bun.sleep`, `Bun.sleepSync`, `setTimeout` and `setInterval`,
   including timer imports from `node:timers` and `node:timers/promises`,
   except a literal zero delay, which yields a turn and waits on no time.
   A test that waits for a real process waits on its event (output, exit, a
   file), with the runner's timeout as the deadline. Integration and browser
   suites drive real services and keep real time.
5. **The round engine's oracle** (`scripts/round-oracle.test.ts`) walks
   generated commands, ticks and internal decisions through the public
   `RoundRuntime` in every catalogue and reference format, and checks every
   id in `spec/invariants.json` and the engine properties after each step. It
   lives beside `bun invariants`, which composes the same formats; the engine
   package cannot import `@daisy/db`.

## Consequences

- A property failure names its smallest case and replays with its seed.
- The publisher and capture suites run in no real time and assert exact
  timings where they asserted tolerances.
- The engine rewrite (R4.1) is held to the oracle, which knows only the
  public API.
- A walk's lengths spread evenly up to its bound, so a suite sets its run
  count for the total steps it wants.
