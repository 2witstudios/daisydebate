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
- **Entitlement grant:** the account's time-valid `round_analysis` capability,
  separate from its lifetime free requested-analysis allowance.

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

## Requested-work contract

BILL-12/r1 replaces automatic discovery under DEC-363; its implementation and
proof remain in progress in the [Billing plan](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/f3nh50c4v2qsrr2b2ixnksa7).
This is the replacement contract, not acceptance of the unfinished pipeline.

One identity in `round_analyses` belongs to each original frozen human debater
seat. Request admission and stored-report reuse share that identity. A bot's or
judge's seat is never analysed; no ballot is read.

- **Request.** Only the own debater may request completed frozen evidence that
  is actually available and authorized for every relevant participant. There is
  no 24-hour or blanket 180-day Round-age eligibility rule. The canonical account
  fence admits one outstanding request, the analysis feature bounds global
  pending work, and the single usage ledger records the admitted source/period.
  The pending limit is four requests per configured analysis concurrency slot,
  at most 256. Each request has a fixed fifteen-minute execution deadline.
- **Work.** Discovery lists requested work only, in fair due order. A worker
  claims a bounded lease; claim alone does not count allowance. Immediately
  before provider I/O, current token, account, privacy, evidence and remaining
  call budget authorize a durable first-call record. At most two possible paid
  calls belong to the seat, including preserved historical exposure. Four lease
  claims bound nondispatch recovery; each lease lasts at most three minutes and
  never outlives the request. Ordinary subscription lapse does not reattribute
  an admitted request, but current account/privacy/evidence fences still apply.
- **Results.** Received tokens and provider outcome are recorded independently
  of report parsing. Invalid text is still received service; a lost response is
  unknown. Late accounting cannot regain publication or dispatch authority. A
  valid report is published only under current privacy/evidence and lease facts.
  Definite nonservice restores the new reservation at most once only after its
  further calls are excluded. Provider I/O never runs under database locks.
- **Content removal.** Purge or erasure removes report content and dispatch
  authority while retaining only justified terminal request/accounting identity;
  an absent report cannot become a new generation opportunity.

### Historical cohort and cutover

Existing reports and terminal failed/erased identities remain terminal and
readable only under their normal permissions. Old lease claims are possible
provider calls, not proven dispatches; positive aggregate tokens show some
service, not the outcome of every claim. An erasure-created `attempts=1,
model=erased` row is a privacy tombstone, not a paid call. Preserve original
attempt/model/token/creation facts without invented opt-in, count time, lifetime
spend or refund.

Old in-flight leases lose their tokens and automatic authority and become
unrequested identities with their remaining budget: `max(0, 2 - old attempts)`.
Only a fresh authorized user request can use that remainder, on the same seat;
zero remainder cannot generate. Migration replay never resets it.

The old operation can call the provider after its claim returns. Clearing its
DB lease cannot fence that paused process. The one-time greenfield cutover must
stop and drain the old analysis/web processes, verify they are terminated and
cannot restart, apply the forward migration, then start requested workers.
Termination does not prove an already-sent vendor call failed: preserve its
unknown exposure. Production deployment/data actions remain human-controlled.
Own-slot proof must cover a worker paused between claim and I/O, the drain/stop
sequence, old-token refusal, late results and concurrent erasure.

## Configuration and capacity

`ROUND_ANALYSIS_POLICY` (optional JSON) holds the concurrency, scan, lease,
call timeout and model. Round analysis runs if and only if it is set; unset,
there is no worker or new generation; authorized delivered reports remain readable.

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
capabilities are `round.analysis.request` and `round.analysis.read`. A
delivered report remains readable to its authorized debater after an entitlement
lapses (BILL-13/DEC-363). Current own-seat authorization covers both capabilities; the shared allowance
policy and atomic ledger admission separately decide whether a fresh request
uses included access or the one lifetime free analysis. Neither capability replaces current participant admission and an own
completed debating seat.

`GET /api/rounds/[roundId]/round-analysis` (composition in
`features/round-analysis/composition.ts`, the only place the gate meets a
reader) answers a seated debater of a completed Round with:

- `ready` and the report;
- `requestable` with the free or included allowance, before an explicit request;
- `pending` only for an admitted request before its fixed execution deadline;
- `unavailable`;
- `locked` when no fresh allowance is available and no delivered report exists.

Spectators, judges, hosts and anyone else get NOT_FOUND. The ballot read is
the same with and without premium. The database runs the injected read decision
before loading report facts. Reads hold the shared canonical fences of every
frozen participant account in user-id order, without lock upgrades; erasure of
either side therefore wins before any later report read.

`ui/round-analysis` renders the view on the Round page beside the result,
quoting the transcript lines a key moment cites.

## Privacy

`round_analyses.work` holds one explicit request lifecycle for the original
frozen debater seat. Report content is personal and private; only that seat's
authorized debater can read it. `POST /api/rounds/[roundId]/round-analysis`
accepts an empty native form and derives the account from the authenticated
session. The database serializes allowance admission with all frozen participant
accounts, feature capacity, the Round and the work row. No client-provided actor,
source, period or request identity supplies authority.

Report retention is 180 days from the actual request, or original creation for a
historical retained report. This content-retention limit never becomes a maximum
Round age for requesting analysis: actual authorized frozen evidence decides
eligibility, including ranked content's separate retention rules. Expiry and
participant erasure purge reports and dispatch/publication authority without
deleting or resetting the seat identity. Content retention deletes utterance lines; the existing immutable transcript
freeze and its foreign key remain. Neither that retention nor report purging
deletes the analysis identity. Round deletion alone retires the competitive seat.

The private execution metadata preserves original historical observations,
request/deadline, claim count and actual call outcomes. Historical claims remain
possible exposure, never invented dispatch or relief. Calls retain only model,
time, token counts and outcome; prompts and raw answers are not stored. The
account's export excludes lease and attempt authenticators. Purging content
retains bounded execution facts needed for truthful accounting and terminal
identity; late authenticated outcome observations cannot republish or reopen
work. The shared allowance ledger's own account-erasure policy still applies:
a late result never recreates an erased reservation. Lease/attempt authenticators
are stored as SHA3-256 digests, never bearer values.
