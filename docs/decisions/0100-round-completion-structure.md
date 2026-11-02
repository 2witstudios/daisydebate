# 0100: Round completion structure

Status: accepted by the point guard on the owner's behalf, 2026-11-02. Keeps the
behavior of [ADR 0095](0095-honest-round-completion.md), except as stated below.
Plan: [Round completion structure](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/sg0erfrgjv6tsdvok8uqoqfl).

## Context

The post-merge architecture review of PR 541 found Round completion deciding in
SQL on an ambient clock, holding one seat's state across parallel lists, and
deciding completion in two places. The architecture audit of 2026-11 added that a
ballot could be voided in the schema but by no code, and that a tie ended
differently depending on which path noticed it.

## Decision

**Adapters read facts, and the engine decides.** Whether an AI seat can rule, why a
Round's end ended a job, whether a bot's grant owes a stream, which attendance
window is next and whether attendance is settled are pure engine functions over
facts, with time injected. `@daisy/db` still may not import the engine, so these
rules reach it by injection. Its integration suites inject small stand-ins; the
engine's unit tests and the `apps/web` suites run the real rules.

**One panel, one decision.** `JudgingPanel` is an optional human window plus AI
seats, each with one standing, so a human seat with no deadline has no
representation. `decidePanelCompletion` is the one decision. What a Round waits on
reads it, and the ballot route and maintenance both complete through it. The
`complete` command, which took a caller-chosen outcome, is gone.

**A tie has no outcome, on every path (DEC-277).** This changes one behavior: a full
even panel used to end `draw` and now ends with no result and no rating, with the
ruling `judges-split`. Nothing writes `draw` any more.

**No void.** No code ever voided a ballot, so the state, its columns and its copy are
deleted. A tied panel with every human ruled and no AI seat able to rule ends at
once, rather than waiting up to 30 minutes for a re-ruling that cannot happen. This
supersedes the wait ISSUE-942 described.

**One name for the ending.** The decision is `abandoned`, as DEC-276's "existing
abandoned path" says; `resolution_cutoff` is the evidence. `unresolved`,
`infrastructure_unresolved` and "no contest" are gone.

**One attempt record.** A `round_judging_attempts` row is written at dispatch and
settled with its outcome, so it alone says how many calls a job bought, including
one a crash lost. A failed job always has a terminal reason; `ballot_discarded` names
the retention and erasure writers.

**One judging policy.** `judgingPolicy` holds judging's bounds. Attendance says how the
Round ended, and judging names the reason.

## Consequences

- A Round's cutoff is constrained to its final speech's end, like the transcript
  cutoff. Migrations backfill before each constraint, so none can refuse a deploy
  (DEC-304).
- Backfilled `failed` jobs: at least two paid runs read `attempts_exhausted`; every
  other reads `round_ended`. Stored rows cannot tell an old retention or erasure
  discard from a Round ending, so an old discard reads `round_ended`.
- Rating discovery no longer filters on settlement. The writer still refuses an
  unsettled Round, by the engine's rule, and the sweep reports that refusal instead
  of silently skipping the Round.
- A failed judging job changes no Round revision, so the room can show the old state
  for up to the 30 s backstop poll. This is accepted, not hidden.
