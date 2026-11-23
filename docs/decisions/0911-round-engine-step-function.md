# 0911: The Round engine is one step function

Status: accepted (owner, 2026-11-19: "execute it all" on Plan — reconcile,
step R4.1, decision D7 at its default; owner: "we should not be afraid of
major rewrites if it leaves us with cleaner code"). Supersedes
[ADR 0006](0006-ecs.md) and [ADR 0058](0058-one-round-model.md) §6's ECS
execution. Amends [ADR 0164](0164-property-tests-and-virtual-time.md) §2.

## Context

Measured at `334bbc8ac`, 22 November 2026:

- The Round's state was already one plain value: the clock
  (`advanceRoundClock`, incidents, the start gate) moved immutable
  `{ lifecycle, checkpoint, rows }` and returned its changes.
- Around it sat a second copy: an Adobe ECS store (`round-ecs-store.ts`,
  `round-ecs-plugin.ts`, 384 lines) that `round-runtime.ts` (422 lines)
  rebuilt from a capture of itself before every decision — seven
  `restoreRoundStore(capture(store))` sites — so a refused command could be
  thrown away, and into which `transitionOn` replayed each pure clock
  transition field by field. Commands mutated that store.
- Every production caller hydrates a runtime, calls one or two methods and
  discards it. Nothing read the store but those files. `@adobe/data` is
  pre-1.0, needed a boundary rule to keep it in one package, and brought a
  dependency-audit exception (`jsonpath` → `underscore`).

## Decision

1. **`stepRound(state, rules, event)` is the engine.** `RoundState` is the
   clock and the cast. `RoundEvent` names everything that can happen to a
   Round: a command, a tick, activation, a stop, an adjudication, panel
   completion, a start-gate observation and a platform incident. The result
   is a `RoundStep`: the next state, the clock changes, the effects, the
   released members, the floor change and the settled final end, all data.
   It reads no clock, mints no id and mutates nothing. A refusal throws its
   typed error (the error the API has always thrown), and the state it was
   given is untouched because it is immutable.
2. **Ids exist only in the projection.** `projectRoundStep` turns a step into
   the durable writes (`RoundProjection`), minting each opened segment's and
   incident's id from the injected source, in that order, and returns the
   sequence-to-id map the next step needs.
3. **`createRoundRuntime` is the facade.** Its interface and behaviour are
   unchanged for its callers, the golden corpus and the oracle. It holds one
   `RoundState` value and one id map; each call steps, projects, and keeps
   both only when both succeed.
4. **No ECS.** The store, its plugin and `@adobe/data` are deleted. The
   boundary rule that kept `@adobe/*` in the engine becomes a ban everywhere.
5. **The oracle's walks also rotate.** Each walk test runs its fixed seed and
   a rotating one, printed in the assertion; `ROUND_ORACLE_SEED` replays it.
   `bun oracle:sabotage` shows engine mutations that only a walk catches.

## Consequences

- ADR 0058 §6 now reads: Postgres is truth; `stepRound` is execution.
  ADR 0006 is superseded; ADR 0024's rejection of client-side ECS stands as
  history.
- A refused call costs no copy of the Round; there is nothing to restore.
- Callers may later step a Round directly instead of through the facade;
  that is not this decision.
