# 0055: Glicko-2 calculation, ladders and season carry-over

Status: proposed. Implements [ADR 0029](0029-competitive-schema-foundation.md)
item 8 (Glicko-2, one debate is one rating period) and the two ladders of the
draft judge-to-compete record (Ranked and Quick match). When this record is
accepted it amends, each in its own `## Amendment` section:
[ADR 0029](0029-competitive-schema-foundation.md) item 8 (the rating key
gains `ladder`), [ADR 0048](0048-authorization-core.md) section 1 ("only
ranked debates produce ratings": Quick match also rates, on its own ladder)
and [ADR 0033](0033-presence-and-adjudication.md) section 4 (a Quick match
forfeit rates as a loss, like a ranked one). Decisions marked open at the end
were made on the owner's behalf and stay open until the owner confirms or
overrules them.

## Context

The schema has held Glicko-2 state since the baseline (`seasons`, `ratings`,
`rating_changes`), but nothing computes a rating, opens a season or writes
the ledger, and the leaderboard reads sample data. The owner fixed the model
on 2026-10-05: Glicko-2, no debater tiers, and two ladders, Ranked (one human
judge, Daisy's promoted ladder) and Quick match (the AI judge, its own
rating). Before code can be written, the calculation needs parameters,
Daisy's one-debate periods need an answer for idle time, and a new season
needs a starting point.

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
| Season deviation floor | 150                                               |
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

The ledger is ordered by completion. A debate that completed before either
debater's last rating on that format and ladder is refused as a conflict,
so a delayed retry can never apply an older result on top of a newer one.

### 3. Idle time widens the deviation

Because every period holds one debate, Glicko-2's per-period growth alone
would never reflect a debater who stops playing. Before rating, each side's
deviation is widened for the days since it was last rated on that format and
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

### 5. Two ladders, one key

`ratings` and `rating_changes` gain `ladder` (`ranked | quick`), which joins
the key `(actor, format, season, ladder)`, and `debates.mode` gains `quick`.
The ladder vocabulary lives in `@daisy/protocol` beside the debate roles, and
the CHECKs derive from it. `mode = 'ranked'` rates on the Ranked ladder and
`mode = 'quick'` on the Quick match ladder; casual and practice never rate.
Both ladders require canonical rules on a ranked-eligible format (ADR 0030).

### 6. Seasons carry the rating forward

A season is opened, closed or rolled over by the `bun season` CLI, never by a
route in `apps/web` (ADR 0043). At most one season is active. Carry-over is
lazy: nothing is written at rollover. On a debater's first rated debate in a
season, their latest earlier-season state on the same format and ladder
starts the season with the rating and volatility kept and the deviation
raised to at least 150. A debater with no earlier state starts at 1500.
A debate is posted to the season that is active when it is rated, and its
`occurred_at` is the debate's `completed_at`.

### 7. Provisional is derived from the deviation

A rating is provisional while its deviation, widened to now, is above 110 (a
95% range wider than ±220). It is derived for display, never stored, and
replaces the sample rule of ten debates. Debater ratings have no tiers and no
bands.

## Consequences

- One forward migration adds `ladder` to both rating tables and `quick` to
  `debates.mode`. The rating tables are empty in every environment, so there
  is no default or backfill.
- The rating write is one transaction that locks the debate, posts two ledger
  rows and updates the projection under its version. Re-rating a debate is a
  no-op. `@daisy/db`'s `rateDebate` decides nothing: the engine's
  `ratingEligibility` and `planRating` are injected as its decision, because
  the adapter sits below the domain and never imports it. The
  `apps/web` ratings feature (`rateCompletedDebate`) composes the two, and
  the debate completion path calls it once judging lands.
- The leaderboard and profile read real standings, with Ranked and Quick match
  shown separately. They are empty until a ranked-eligible format and an
  active season exist; opening the first production season is a human-only
  task.

## Open decisions (made on the owner's behalf)

1. **τ 0.5 and the one-day inactivity period.** τ is Glickman's example
   value, inside his recommended 0.3–1.2.
2. **Season floor of 150.** The owner chose "carry the rating, widen the
   deviation"; the amount is this record's.
3. **Provisional above 110.** The same threshold as a widely used chess
   ladder.
4. **Quick match needs canonical rules and rates forfeits.** Keeps both
   ladders comparable in integrity.
5. **Bounds 30–350 and volatility ≤ 0.1.** Keep every write inside the
   database CHECKs with room to spare.
