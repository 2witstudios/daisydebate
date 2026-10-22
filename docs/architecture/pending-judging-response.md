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
requires the same update to mark success and reference an actual submitted ballot
with that Round, judge and freeze revision. The caller must perform actual shared
ballot submission and cache clearing in one bounded transaction. A later retry
consumes this validated cache, never an unvalidated provider envelope or a usage
counter. Owning Round erasure cascades the job and its cache; the scoped origin
run FK is deferred NO ACTION so whole-aggregate erasure remains possible.

Privacy: pending ballot reason, feedback, scores and citations are personal,
private derived judging data. Purpose: recover the validated provider result
without duplicate dispatch while attendance settlement remains unresolved.
Lawful basis and production legal approval remain the existing ballot/PRIV-H
human sign-off; this schema is not a new legal approval. Retention follows the
existing ballot policy (180 days), with earlier clearing on successful submission;
subject/owning Round erasure removes it. Origin run/job/seat IDs are identifiers;
origin epoch and receipt timestamp have category none. No bearer, prompt,
frozen-transcript copy or raw provider envelope is retained here.
