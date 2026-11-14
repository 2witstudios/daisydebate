import { canonicalOrder } from '@daisy/seeded-random';
import type { Id } from '../shapes/competition';
import type {
  Rational,
  Standings,
  StandingsInput,
  StandingsRow,
} from '../shapes/folds';
import { isLowerBetter, meetings, metricValue } from './metric-value';
import { type Ordered, refine } from './refine';
import { type Tally, gamesCount, tallyOf } from './tally';

const rowsOf = (
  order: readonly Ordered[],
  ranked: boolean,
  input: StandingsInput,
  tally: Tally,
  headToHead: ReadonlyMap<Id, readonly Rational[]>,
): StandingsRow[] => {
  const metrics = input.settings['standings.tiebreaks'].metrics;
  let rank = 0;
  return order.map(({ entry, separatedBy }, i) => {
    if (separatedBy !== 'shared') rank = i + 1;
    return {
      entry,
      rank: ranked ? rank : null,
      games: gamesCount(tally, entry),
      values: metrics.map((metric) => ({
        metric,
        value:
          metric === 'head_to_head'
            ? (headToHead.get(entry) ?? [])
            : metricValue(tally, entry, metric),
      })),
      separatedBy,
    };
  });
};

/**
 * An event's standings at a cutoff: every entry passed in (withdrawn ones
 * too) in one row, ordered by partition refinement over the tiebreak
 * metrics. A division selects rows only: every result of the event counts.
 * An entry below the minimum games is listed after every ranked entry,
 * unranked, refined among its own kind.
 */
export const standings = (input: StandingsInput): Standings => {
  const tally = tallyOf(input);
  const tiebreaks = input.settings['standings.tiebreaks'];
  const selected = canonicalOrder(input.entries).filter(
    (e) => input.division === null || e.division === input.division,
  );
  const enough = (id: Id) =>
    tiebreaks.minimumGames === null ||
    gamesCount(tally, id) >= tiebreaks.minimumGames;
  const refinement = {
    metrics: tiebreaks.metrics,
    valueOf: (entry: Id, metric: (typeof tiebreaks.metrics)[number]) =>
      metricValue(tally, entry, metric),
    lowerIsBetter: isLowerBetter,
    meetings: (entry: Id, other: Id) => meetings(tally, entry, other),
    terminal: tiebreaks.terminal,
    seed: input.seed,
  };
  const ranked = refine(
    selected.filter((e) => enough(e.id)).map((e) => e.id),
    null,
    refinement,
  );
  const unranked = refine(
    selected.filter((e) => !enough(e.id)).map((e) => e.id),
    'minimum_games',
    refinement,
  );
  return {
    rows: [
      ...rowsOf(ranked.order, true, input, tally, ranked.headToHead),
      ...rowsOf(
        unranked.order.map((o) => ({
          ...o,
          separatedBy: 'minimum_games' as const,
        })),
        false,
        input,
        tally,
        unranked.headToHead,
      ),
    ],
    rated: input.ratings !== null,
    results: tally.results,
  };
};
