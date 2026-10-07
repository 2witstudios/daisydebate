# Round runtime boundary

Owner: domain engineers. Public API: `@daisy/debate-engine`; the Adobe ECS adapter is internal. The runtime is framework-free and has no ambient clock, I/O, or persistence handle.

Every competitive occurrence is one Round, whether its seats hold people or bots and whether it is ranked, casual, or practice ([ADR 0058](../decisions/0058-one-round-model.md)). A durable Room resolves a `FormatDefinition` and `RoomConfig` into a `RoomExecutionPlan` and fully resolved `RoundRules`. Ranked rooms use an approved preset as their config. The Room pins its format and preset revisions, executes any pre-round prep, and freezes its seats and rules into a scheduled Round. `startRound()` never compiles rules.

PostgreSQL owns the Round lifecycle, participant seats, command log, segment intervals, utterances, ballots, and rating ledger. The one open `round_segments` row is the live interval. A Round's checkpoint holds only state with no segment row: side-keyed in-round prep consumption and anchor, plus the floor after an accepted interruption. The runtime hydrates from those rows and the frozen rules, executes one legal command or clock tick in an isolated ECS store, and returns a projection for the adapter to persist under a version check. A refusal leaves the runtime unchanged. The runtime itself is disposable process-local execution state, never a durable session.

Seats are authoritative `round_participants` rows with surrogate participant ids. They are not copied into a snapshot. The runtime verifies each row against the resolved rules and refuses a Round with missing or duplicate required slots. The three identities have different lifetimes: `actors.id` identifies the person or bot, `round_participants.id` identifies that actor's seat in one Round, and `agent_runs.id` identifies one AI execution on a seat. A judge uses the same seat model and the shared ballot contract.

The application passes an explicit actor or service principal and one database-sourced UTC instant into execution. Time changes are projected as segment closes and inserts, then written in that order so the partial unique index can enforce at most one open segment. The final segment remains open until the ballot completes the Round. Command IDs and SHA3-256 payload digests are stored with the resulting version for idempotency. Callers rehydrate after a version conflict instead of replaying stale state.

The browser may derive a read-only virtual position through `@daisy/debate-engine/position`; this pure entrypoint loads no ECS codegen and works under the nonce CSP. It never writes the virtual rows back. The server persists actual clock movement through the runtime. Tests cover the same countdown, prep, live segment, and ballot boundary on both paths.

Ratings are pure functions beside the runtime ([ADR 0055](../decisions/0055-glicko-2-calculation-ladders-and-seasons.md)). `ratePeriod` implements Glicko-2; `ratingEligibility` and `planRating` decide whether a completed Round updates the ranked or quick ladder and produce the two ledger changes. The adapter loads the stored facts and writes the plan transactionally. Ratings never come from Redis or the ECS store.

Run `bun test packages/debate-engine/src` for deterministic runtime and rating tests. Service-backed persistence proof lives in `packages/db/integration/` and runs with `bun test:integration`.
