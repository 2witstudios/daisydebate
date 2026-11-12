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

## Coherency stages

[ADR 0125](../decisions/0125-coherency-judging.md) splits AI judging into three
stages, one provider call each:

- the first-pass ballot, an internal record;
- the case map, read from the transcript alone;
- the final ballot, decided from the transcript and the map.

The job's stored stage outputs say which stage a claim may buy (`first`, then
`map`, then `final`). Dispatching any other stage is refused. A stored first pass
or case map is written once by its own stage's attempt, which also records the
stage. The job is then released as immediately due, so the next claim buys the
next stage, and a takeover never buys a stored stage again. A failed first pass
sets `first_ballot_failed` and the job continues; only the final stage produces
the held response described above.

The stage records stay after success as the first-pass-against-final
comparison. They are private derived judging data, like the held response:

- the retention sweep (`retention.judging_stages`) clears them 180 days after
  receipt;
- subject erasure clears them for every non-ranked Round the subject sat in;
- owning Round erasure cascades them.

## Attempt windows and durable recovery

DEC-370 and [ADR 0119](../decisions/0119-recoverable-round-evidence-and-result.md)
separate the result obligation from a provider attempt window. A job buys at most
four potentially paid calls in one generation window (the three coherency stages
and one retry; ADR 0125, DEC-390), identified by its first
lease epoch rather than timestamp coincidence. A spent window releases its lease
and enters `recovering`, with exponential backoff from 30 seconds to five minutes.
Claiming due recovery starts a new bounded window under the same freeze, command
and pinned model. Uncertain dispatched calls remain counted after a crash.

Automatic lifetime spending is finite: twenty-four potentially paid calls. Exhaustion
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

Discovery samples eligibility once, excludes a Round with any live judging claim,
prefers a validated reply within each Round, and selects one eligible judge per
Round before applying the bounded page limit. The service still visits later
cached replies when paid provider capacity is unavailable.

Cached submission and generation each have an explicit bounded discovery query;
the work kind is mandatory and filters before pagination. A full page of older
uncached Rounds therefore cannot hide a later held reply. Each service pass reads
both bounded pages independently and can use one successful page if the other
read is refused. Generation retains its configured local/provider capacity;
cached submission has one separate local slot and consumes no provider slot.
Cached work cannot monopolize the generation slots. Each key is visited at most
once per pass, including retries already started before discovery.

`last_claimed_at` records the actual post-lock PostgreSQL claim instant in the
claim transaction. The Round's turn is the latest actual claim across all its
members, including finished members. A never-claimed Round uses its original job
creation instant as an ordering fallback; that is not an invented historical
claim timestamp. Retry time controls eligibility only, so new arrivals cannot
gain permanent priority over already-served due recovery. The service and
Round-locked store admit at most one running judging operation per Round.
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
