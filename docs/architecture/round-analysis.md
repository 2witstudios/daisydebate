# Round analysis

Round analysis is Daisy's premium post-round report: a game review of one
debater's performance in one completed Round ([ADR 0085](../decisions/0085-round-analysis-is-its-own-product.md),
DEC-247). It is not judging. The judge's feedback is part of the ballot;
round analysis is a separate product with its own data, prompt, budget,
table, route and UI.

## Concepts

- **Ballot:** the judge's decision, human or AI: winner, rubric scores,
  reason and judge feedback for each side. Owned by `round-judging` and
  `round-ballots`, and never premium-gated.
- **Round analysis:** the report on one debater seat. It never reads, waits
  on or replaces a ballot, and it never decides the Round.
- **Transcript evidence:** the neutral frozen input both features read:
  `@daisy/ai-voice` `transcript-evidence.ts` and web
  `features/round-runtime/transcript-evidence.ts`.
- **Analysis history:** the same debater's earlier succeeded analyses (skill
  scores only), read for patterns across Rounds.
- **Entitlement grant:** the account's `round_analysis` grant
  (`account_entitlement_grants`), written by the beta access command.

`scripts/check-boundaries.ts` refuses any import between round analysis and
judging, and any new identifier or copy using the word "coach", which is
reserved for future human coaches.

## The report

`packages/protocol/src/round-analysis.ts` owns the versioned contract
(`analysisVersion` 1):

- a summary;
- one to three improvements ("how to get better");
- up to five key moments, each citing a transcript line, with what happened,
  why it mattered and the strongest reply;
- up to five missed opportunities, each citing a line;
- six skills scored 1 to 5, each with a note: refutation, extension,
  weighing, evidence, cross-examination and structure;
- up to three patterns, only when the debater has earlier analyses.

The skills are round analysis's own dimensions, not the ballot rubric. The
parser in `@daisy/ai-voice` `round-analysis.ts` enforces the limits and
refuses any cited line that is not in the freeze, so a report never points
at speech that did not happen.

## Pipeline

One row in `round_analyses` per human debater seat, keyed by the seat and
bound by foreign key to the frozen transcript revision it read. A bot's seat
and a judge's seat are never analysed.

- **Discovery** (`round-analysis-jobs.ts`) lists the debater seats of frozen
  Rounds with lines completed within the window and with no row yet, plus
  every lapsed lease. It reads no ballot. Seats whose debater lacks the
  entitlement are filtered out with advisory account facts; a bounded cursor
  advances past denied candidates.
- **The decision** is pure, in `features/round-analysis/policy.ts`: a seat
  needs an analysis when its Round completed within 24 hours and froze at
  least one line. It buys at most two paid calls.
- **A claim** takes the Round's lock, refuses a Round with an erased
  participant, rereads the seat account's facts and grants under its fence,
  and applies the decision before an attempt is spent. It returns the
  freeze, the seat and the debater's history.
- **The call** runs inside round analysis's own provider budget, under a
  lease that covers the whole call. Usage is recorded on the row before the
  answer is validated; only a valid report is stored, and only while the
  lease holds. Failures log `round.analysis.failed`.

## Configuration and capacity

`ROUND_ANALYSIS_POLICY` (optional JSON) holds the concurrency, scan, lease,
call timeout and model. Round analysis runs if and only if it is set; unset,
there is no worker and every view is `unavailable`.

`server/round-analysis-workers.ts` starts the worker with its own lifecycle.
Its provider budget is its own instance of `server/provider-budget.ts`; AI
judging and live bot speech share the separate competitive budget
(`COMPETITIVE_PROVIDER_CONCURRENCY`). The two never share a counter, so a
full analysis budget never refuses competitive work, and the reverse.

## Premium and reads

Premium is the account's own `round_analysis` grant, never its beta state
(ISSUE-779). Beta approval writes the grant in the beta command's
transaction and revocation removes it. `PREMIUM_BETA_GRANT` says whether a
beta-sourced grant counts: `true` in the beta, `false` at launch. The
capabilities are `round.analysis.generate` and `round.analysis.read`. An
entitlement supplements, never replaces, participant admission and an own
debating seat.

`GET /api/rounds/[roundId]/round-analysis` (composition in
`features/round-analysis/composition.ts`, the only place the gate meets a
reader) answers a seated debater of a completed Round with:

- `ready` and the report;
- `pending` while an analysis runs or will run;
- `unavailable`;
- `locked`, with no content, when the debater lacks the entitlement.

Spectators, judges, hosts and anyone else get NOT_FOUND. The ballot read is
the same with and without premium.

`ui/round-analysis` renders the view on the Round page beside the result,
quoting the transcript lines a key moment cites.

## Privacy

`round_analyses.report` is personal and private: each report reaches only
its seat's debater. The adopter in `round-analysis-privacy.ts` declares
every column. Retention is 180 days from job creation
(`retention.round_analyses`), like the transcript the report reads. Subject
erasure clears every analysis of a Round the subject sat in, since a report
quotes both sides, and leaves each human seat `failed` so it is never
analysed again. The lease token is stored only as a SHA3-256 digest.
