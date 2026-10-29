# 0055: Glicko-2 calculation, ladders and season carry-over

Status: partially accepted. DEC-110 confirms calculation parameters and
DEC-119 confirms posting order; DEC-111 season/provisional calibration
remains unresolved. [ADR 0090](0090-three-rating-ladders.md) supersedes the
single-ladder vocabulary with three ladders. Implements [ADR 0029](0029-competitive-schema-foundation.md)
item 8 (Glicko-2, one debate is one rating period).
When this record is accepted it amends, in its own `## Amendment` section,
[ADR 0029](0029-competitive-schema-foundation.md) item 8 (the rating key
gains `ladder`). Decisions marked open at the end
were made on the owner's behalf and stay open until the owner confirms or
overrules them.

## Context

The ratings feature composes the pure Glicko-2 calculation with durable
finalized-Round discovery, transactional ledger posting and published standing
reads. Freestyle, Policy and Value are independent pools under ADR 0090.
Beta activation remains an explicit post-deploy operation with live evidence
tracked under RATE-5; production retains RATE-H.1.

## Decision

### 1. The calculation is Glickman's, pure, in the engine

`@daisy/debate-engine` computes ratings as pure functions: `ratePeriod` is
Glickman's Glicko-2 (2012), steps 2 to 8 with the Illinois volatility search,
and `rateDebate` applies Daisy's rules below. Neither reads a clock, an id or
storage; the caller passes the stored states, when each debater was last
rated, the outcome and the debate's completion time.

| Parameter              | Value                                             |
| ---------------------- | ------------------------------------------------- |
| New debater            | rating 1500, deviation 350, volatility 0.06       |
| τ                      | 0.5                                               |
| Volatility search      | ε = 1e-6, at most 100 steps                       |
| Inactivity period      | one day                                           |
| Season deviation floor | unresolved; rollover refused                      |
| Provisional above      | deviation 110                                     |
| Bounds                 | rating 0–4000, deviation 30–350, volatility ≤ 0.1 |

`RATING_CALCULATION_VERSION = 'glicko2-v1'` names exactly this table. Any
change to it is a new version, written to `rating_changes.calculation_version`,
so history is never rewritten.

### 2. One debate is one period for each side

Each side is rated against the other's state from before the debate, never
against the other's new state. A win scores 1, a draw 0.5, a loss 0. An
abandoned debate never rates. A forfeit has a side outcome (ADR 0033) and
rates exactly like a judged result, so rating reads `outcome` and ignores
`outcome_reason`.

Each debater's ledger is ordered by posting, and a late debate is never
lost. A debate is posted at its completion. If either debater was already
posted at or after that instant, it is posted one millisecond after the
latest such posting instead. This happens when another debate sharing a
debater was rated first, or when a retry was delayed. So `before(n) =
after(n - 1)` holds in `occurred_at` order for every debater, and late results are retained. Sequential Glicko updates still depend on
posting order; this rule does not claim order-independent results.

### 3. Idle time widens the deviation

Because every period holds one debate, Glicko-2's per-period growth alone
would never reflect a debater who stops playing. Before rating, each side's
deviation is widened for the days since it was last rated on that
ladder: φ* = √(φ² + t·σ²), with t in days, capped at 350. A deviation of 60
reaches about 83 after a month idle and about 208 after a year. The ledger's
`*_before` columns record the stored state before widening, so within a
season `before(n) = after(n − 1)` and the widening is reproducible from
`occurred_at` and the calculation version.

### 4. Results stay inside the ledger's bounds

A computed state is clamped to the bounds above. A stored state outside them,
or any value that is not finite, is refused with the invariant
`debate.rating.state-bounded`; a volatility search that exceeds its steps is
refused with `debate.rating.volatility-converges`. Both are registered in
`spec/invariants.json`.

### 5. Rating pool identity

The standing identity is `(actor, ladder, season)`, with ladder exactly
`freestyle`, `policy` or `value`. Format revision belongs to Round and ledger
provenance, never to the standing key. Frozen Round `ladder_id` is the sole
authority; a database constraint binds each canonical format ID to its identical
ladder ID. Casual has no ladder.

### 6. Season activation and unresolved carry-over

`bun season activate-beta` opens the shared Season 1 at the database's actual
activation instant under key `beta-season-1`. Concurrent invocations return the
same record. A retry returns even a closed Season 1 unchanged; another season
causes refusal. Startup never activates a season.

A debate posts to the active season with DEC-119 ordering. New actors start
from the confirmed initial parameters. Prior-season carry-over and rollover
refuse pending DEC-111: the proposed floor150 is not authorized by beta RD110
policy. No prior-season history is invented.

### 7. Provisional is derived from the deviation

A rating is provisional while its deviation, widened to now, is above 110 (a
95% range wider than ±220). It is derived for display, never stored, and
replaces the sample rule of ten debates. Debater ratings have no tiers and no
bands.

## Consequences

- Ratings owns durable discovery, calculation composition, ledger posting,
  standing aggregation, ranking, classification and viewer blinding. Leaderboard,
  profile and Round displays consume its named published output.
- Posting locks Round, active season SHARE, then sorted ratings-owned actor/ladder
  advisory keys before reading state. Two ledger rows and both projections commit
  atomically. Duplicate posting is a no-op. See ADR0090 for lock interoperation.
- Human and system-AI judged results and eligible forfeits consume shared Round
  terminal provenance. No ballot result is recomputed by ratings.
- Closed-season standing classification uses the closure instant. Historical
  Round badges use the actual posting's deviation. Current displays widen at one
  injected read instant and classify before rounding.

## Calibration decisions

DEC-110 confirms items 1 and 5. DEC-111 retains the unresolved future season floor in item 2. Delegated
DEC-266 selects widened RD >110 for beta provisional display, explicitly as beta
policy rather than empirically optimal calibration. DEC-266 remains open for
owner confirmation; point-guard delegation authorizes execution. Eligible forfeits retain the outcome
policy in section 2; this record does not newly approve ranked admission.
The original parameter list is preserved below.

### Original decisions made on the owner's behalf

1. **τ 0.5 and the one-day inactivity period.** τ is Glickman's example
   value, inside his recommended 0.3–1.2.
2. **Season floor of 150.** The owner chose "carry the rating, widen the
   deviation"; the amount is this record's.
3. **Provisional above 110.** The same threshold as a widely used chess
   ladder.
4. **A ranked forfeit rates as a loss.** A forfeit carries a side outcome
   and rates like a judged result.
5. **Bounds 30–350 and volatility ≤ 0.1.** Keep every write inside the
   database CHECKs with room to spare.

## Amendment (2026-10-25, DEC-237, DEC-238)

Every Round is full length, so the Quick match ladder has no producer and is
removed: `ratingLadders` is `['ranked']`, and the forward migration
`20261025223110_full_length_only` deletes any Quick-ladder ratings and ledger
rows (DEC-240) before the ladder CHECKs tighten. `ladder` stays in the rating
key as the pool a rating belongs to.

## Amendment (2026-10-28, DEC-265)

[ADR 0090](0090-three-rating-ladders.md) selects Freestyle, Policy and Value
for current delivery and retains one frozen ladder authority. The previous
Quick removal remains; the generic Ranked pool is removed by a fail-closed
forward migration. Existing rated data requires explicit disposition before any
DDL. No relabel, reset or compatibility pool is supplied.
