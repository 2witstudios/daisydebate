# 0090: Three Daisy rating ladders, one rating authority

Status: accepted product direction (owner instruction, 2026-10-28;
[DEC-265](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/mtujpjaqvweg38z5iv7b0eod)).
Implemented by the ratings slice; deployed beta activation evidence remains a
post-deploy acceptance item. Amends the ladder vocabulary in [ADR 0055](0055-glicko-2-calculation-ladders-and-seasons.md)
and reconciles the ratedness authority in [ADR 0058](0058-one-round-model.md).
Calculation calibration still open under DEC-111 is not accepted by this record.

## Context

Rounds, judging and ballots share one durable competitive result. Ratings
consumes the immutable terminal provenance of that result, posts Glicko-2
changes transactionally and publishes shared standing output. Freestyle,
Policy and Value have independent actor+ladder+season standings. Beta Season 1
activation remains an explicit post-deploy acceptance item.

DEC-238's task status is Confirmed, although its page retained an older
blocked reconciliation. It names frozen `ladder_id` as ratedness authority.
ADR 0058 instead stated both `ladder_id` and `competition_type` were the
sole authority. This record removes that contradiction.

## Decision

### Three pools owned by one rating feature

Daisy has exactly three ladders: Freestyle, Policy and Value. An eligible
Round contributes to exactly one. A format revision, Room setting, judge
implementation or entry path does not create a fourth pool. Custom, Quick,
league and tournament ladders are not selected.

One rating feature owns calculation policy, ledger writes and standing
projections. It consumes the authoritative finalized Round result, including
eligible human- or AI-judged outcomes and forfeits. It does not reconstruct
ballots or create a second outcome. Ranked admission is bounded by delegated DEC-266 below; sharing the outcome
contract is not permission to admit any cast.

Leaderboard, profile and Room displays read this feature's published output.
They do not calculate separate ratings, provisional status or invented
stakes. PostgreSQL owns durable competitive truth; Redis is expendable.

### One ratedness authority

The Round's frozen `ladder_id` is the sole authority: null means unrated;
a non-null value identifies its rating pool. `competition_type` is
constrained context and cannot independently award or refuse a rating.
Sanctioned configuration constructs eligible rated Rounds through the
existing shared Room/ Round path and pins format provenance. Readers cannot
infer a pool from a mutable format label, Room state or UI choice.

The standing key is `(actor, ladder, season)`: one individual standing in
each ladder per season. Format and pinned rules remain Round provenance,
not another rating dimension. The canonical IDs map identically to ladder IDs and are constrained at the
Round boundary. Future team play does not
automatically create separate pools; its participant-update policy is
resolved when team play is selected. No generic Ranked compatibility pool
survives implementation.

### One idempotent posting policy

Every eligible finalized result posts exactly once to its ladder. Retries
and concurrent delivery must not duplicate ledger entries or split the two
debaters' updates. Unjudged or abandoned Rounds do not fabricate a rating;
existing transcript and eligibility constraints remain obligations.

Confirmed DEC-110 fixes the Glicko-2 calculation parameters and version.
Confirmed DEC-119 fixes monotonic posting order: post at completion, or one
millisecond after the latest applicable posting if necessary, preserving
`before(n) = after(n - 1)`. This orders the ledger; it does not make
sequential Glicko updates independent of the order in which results post.
No new formula, tiers or calibration is introduced here.

### Season 1 is the beta season

The owner selected Season 1 as the beta season in the same discussion.
Deliver the rating rollout with that season opened for all three ladders.
Activation must be explicit and idempotent: retries or redeploys cannot
create a second season, reset standings or roll over a season. The season
starts at the actual activation instant, not at documentation time.

This selects beta activation as part of implementation; it does not run a
season operation in this documentation change. Production activation retains
its human sign-off requirement. Exact deployment composition and proof belong
in the implementation plan.

## Admission and beta policy (delegated DEC-266)

Rated play is explicit opt-in; casual is the default. Stable catalog IDs
`freestyle`, `policy`, `value` map identically to ladder IDs. Admission requires
the current approved eligible preset, one human on each debating side, and
exactly one human or existing system AI deciding judge. Custom formats, bot
debaters, panels and league/tournament pools are excluded. Policy and Value keep
the existing resolution freeze; Freestyle keeps shared strike/draw/prep setup.

Widened RD >110 selects provisional beta display at full precision. The
calibration table and deterministic boundary/inactivity proof live in the slice
plan. This is delegated beta policy, not optimal empirical calibration or a
claim of personal owner selection. DEC-266 remains open for owner confirmation.
DEC-111's future rollover floor remains unresolved; rollover and prior-season
carry-over refuse. Confirmed initial parameters and glicko2-v1 are unchanged.

## Terminal provenance and recovery

Shared Round owns `round_finalizations` and its exact consumed ballot membership.
Every terminal producer passes its validated nonterminal-to-terminal transition;
a later no-op cannot create missing provenance. References bind original command,
resulting version and optional transcript freeze. Genuine pre-freeze forfeits
and abandonment permit no freeze and empty ballots. Membership is captured by
the authoritative finalizer's filtering in the same transaction. Later ballot
voiding does not replace the finalized outcome or membership.

References are immutable competitive-record provenance, retained with Round.
Aggregate deletion cascades them; direct deletion of a consumed ballot is
restricted with deferred references to allow aggregate cascade ordering.
Erasure preserves the competitive record and username under ADR0087.

Ratings scans durable eligible outcomes with bounded keyset pages, advances past
per-row failures and restarts from the beginning on the next pass. Discovery and
transactional posting share finalized-input and attendance-settlement predicates.
Posting rechecks under the Round fence; discovery alone never authorizes writing.
Failures use the existing scrubbed worker reporter without Round IDs in logs.

## Lock order and writer interoperation

Posting acquires Round NO KEY UPDATE, active season SHARE, then its own
`pg_advisory_xact_lock(59090, hashtext(ladder || ':' || actor))` resources. Actual
int32 keys are deduplicated and numerically sorted before acquisition and before
loading standings or last-post state. Scope excludes season because DEC-119
orders an actor's ladder postings across seasons. Hash collisions cause extra
serialization only. PostgreSQL's two-int advisory resources are disjoint from
single-bigint command locks; a seed alone would not establish that namespace.

Existing writers acquire authorization accounts before Round. Ratings acquires
no shared account/actor row lock after Round and never mutates accounts, so it
cannot reverse that fence. Season close takes its season row without later
Round/rating locks. Activation takes its own `(59091,1)` transaction lock and no
Round/rating locks. Real PostgreSQL tests observe blocked lock chains for
erasure/post and close/post, plus overlapping first inserts and swapped sides.

## Delivery boundary

One backend and UI PR carries RATE-4, RATE-5, RATE-6 and ISSUE-435. Code merge
readiness includes isolated proofs and the operator handoff; actual beta
activation and verified live standing/UI evidence remain open after eligible
main deployment. RATE-H.1 and human production migration preflight precede
production data actions. Builders never merge or access production.

A full matchmaking queue is separate from this slice; existing queue intent is
preserved. The existing shared setup is the rated entry path.

## Consequences

- The rating intent and epic select three ladders while retaining truthful
  implementation scores and unfinished acceptance criteria.
- DEC-204's earlier goal-specific deferral is superseded for this outcome.
  DEC-238 retains Quick removal and its authority rule; only its single-pool
  vocabulary is superseded.
- RATE-3 no longer waits for DEC-119 confirmation; its documentation
  reconciliation moves to review. An empty matchmaking phase is not Done.
- Implementation must replace the old pool vocabulary throughout contracts,
  persistence, consumers and tests in one coherent transition. This record
  does not prescribe destructive migration behavior or authorize a reset.
