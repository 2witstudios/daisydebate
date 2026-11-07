# Pending judging response recovery

A judging job can retain one validated `Ballot` while competitive attendance
settlement prevents the shared ballot transaction from committing. The cache is
scoped by the job's immutable Round, freeze revision and judge. Its origin AgentRun
is constrained to that judge seat; origin epoch is positive and cannot exceed the
job's attempt count. The PostgreSQL receipt timestamp and all four cache fields
are paired. An attempt takeover preserves the original response and provenance;
it must not dispatch the provider again to replace an already validated result.

`pending_ballot` uses the public strict Ballot validator before driver I/O and a
named PostgreSQL JSON object CHECK. A pending tuple cannot change. Clearing it
requires the same update either to mark success and reference an actual submitted
ballot with that Round, judge and freeze revision, or to end a job that has not
succeeded as `failed`, its terminal state, which discards the response (DEC-223).
Only retention and subject erasure take the second path. The caller must perform actual shared
ballot submission and cache clearing in one bounded transaction. A later retry
consumes this validated cache, never an unvalidated provider envelope or a usage
counter. Direct job deletion or deletion through its freeze is refused while a validated response remains and its owning Round exists. Owning Round erasure cascades the job and its cache; the scoped origin
run FK is deferred NO ACTION so whole-aggregate erasure remains possible.

## Attempt windows and durable recovery

DEC-370 and [ADR 0119](../decisions/0119-recoverable-round-evidence-and-result.md)
separate the result obligation from a provider attempt window. A job buys at most
two potentially paid calls in one generation window, identified by its first
lease epoch rather than timestamp coincidence. A spent window releases its lease
and enters `recovering`, with exponential backoff from 30 seconds to five minutes.
Claiming due recovery starts a new bounded window under the same freeze, command
and pinned model. Uncertain dispatched calls remain counted after a crash.

Automatic lifetime spending is finite: sixteen potentially paid calls. Exhaustion
enters `blocked` with `automatic_spend`; a refusal that requires intervention also
blocks automatic work. Neither state is a no-result ruling. The room distinguishes
recovering work from work needing attention. This supports automatic recovery
within the remaining funding/outage window; it makes no unconditional eventual
result claim beyond that window. Operator replenishment/reconfiguration and its
authorized interface remain part of the slice's unfinished recovery remedy.

A validated current response is saved even if its generation window has just
ended. The provider call's independent timeout still bounds execution. Renewal
does not discard a current result at the window edge. Takeover must consume the
saved response without another paid call, and stale claimants remain refused.
The former attendance grace does not expire a held response. Explicit final
Round authority and the separate privacy/retention rules still apply.

Discovery orders by the due service turn and stable identifiers; a claim records
its turn so an repeatedly reclaimed job moves behind older due work. The service
and Round-locked store admit at most one running judging operation per Round.
The growing-backlog and fleet fairness proofs remain required; a pending row or
these source rules alone do not prove liveness.

Privacy: pending ballot reason, feedback, scores and citations are personal,
private derived judging data. Purpose: recover the validated provider result
without duplicate dispatch while attendance settlement remains unresolved.
Lawful basis and production legal approval remain the existing ballot/PRIV-H
human sign-off; this schema is not a new legal approval. Retention follows the
existing ballot policy (180 days), with earlier clearing on successful submission.
The retention sweep (`retention.pending_ballots`) discards a response 180 days after
`pending_ballot_received_at`. Subject erasure (the `round-transcript` privacy adopter)
discards every pending response of a Round the subject sat in, and owning Round
erasure cascades it (ISSUE-498). Origin run/job/seat IDs are identifiers;
origin epoch and receipt timestamp have category none. No bearer, prompt,
frozen-transcript copy or raw provider envelope is retained here.
