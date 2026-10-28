# 0090: Three Daisy rating ladders, one rating authority

Status: accepted product direction (owner instruction, 2026-10-28;
[DEC-265](https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/mtujpjaqvweg38z5iv7b0eod)).
Implementation pending. Amends the ladder vocabulary in [ADR 0055](0055-glicko-2-calculation-ladders-and-seasons.md)
and reconciles the ratedness authority in [ADR 0058](0058-one-round-model.md).
Calculation calibration still open under DEC-111 is not accepted by this record.

## Context

Rounds, judging and ballots already share a durable competitive result. The
rating foundation has Glicko-2, a ledger and season operations, but judged
ranked results do not yet post ratings (ISSUE-435), and ranked screens still
use sample data. The owner has selected ratings for delivery now with three
ladders: Freestyle, Policy and Value. This replaces the after-beta deferral
and the single generic Ranked pool; it does not claim delivery.

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
ballots or create a second outcome. Judge eligibility for ranked admission
must be resolved explicitly during detailed design; sharing the outcome
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
not another rating dimension. Detailed design must define the canonical
format-to-ladder mapping and constraints. Future team play does not
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

## Delivery boundary and remaining decisions

The owner requested state, decisions and ADR reconciliation first. Detailed
tasks, schema/migration design and implementation follow in a later pass,
probably using opencode agents. This pass spawns no implementation agents
and changes no runtime behavior, schema, season or production data.

The next planning pass must resolve DEC-111 season floor/provisional
calibration, ranked admission and judge eligibility, canonical presets and
format mapping, remaining Freestyle journey gaps, and anti-abuse boundaries.
A full matchmaking queue is a separate scope decision, not an implied
prerequisite for posting ratings. Existing queue acceptance intent remains
preserved. Season 1 beta activation is in scope; first production activation
still requires the owner (RATE-H.1).

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
