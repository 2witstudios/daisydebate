import type { Id } from '../shapes/competition';
import type { Rational } from '../shapes/folds';
import type { Metric } from '../shapes/settings';
import { multiply, rational, sum, zero } from './rational';
import {
  type Tally,
  byesOf,
  countedGames,
  gamesCount,
  playedOf,
} from './tally';

/** The metrics where a smaller value is the better standing. */
const lowerIsBetter: ReadonlySet<Metric> = new Set([
  'cumulative_rank',
  'rank_truncation',
  'worst_rank_drop',
]);
export const isLowerBetter = (metric: Metric) => lowerIsBetter.has(metric);

/** Under `own_average`, a total over g played games stands for g + byes: × (g + b) / g. */
const byeScale = (tally: Tally, entry: Id): Rational => {
  const played = playedOf(tally, entry).length;
  const byes = byesOf(tally, entry);
  return tally.byeResult === 'own_average' && played > 0 && byes > 0
    ? rational(played + byes, played)
    : rational(1);
};

const count = (n: number) => rational(n);

const ranksOf = (tally: Tally, entry: Id) =>
  countedGames(tally, entry).flatMap((g) => g.ballots.map((b) => b.rank));

const winsTotal = (tally: Tally, entry: Id) =>
  count(countedGames(tally, entry).filter((g) => g.won).length);

const pointsTotal = (tally: Tally, entry: Id) =>
  count(
    playedOf(tally, entry).reduce(
      (s, g) => s + g.ballots.reduce((t, b) => t + b.points, 0),
      0,
    ),
  );

const highLow = (tally: Tally, entry: Id) => {
  const perGame = playedOf(tally, entry).map((g) =>
    g.ballots.reduce((t, b) => t + b.points, 0),
  );
  const total = perGame.reduce((s, p) => s + p, 0);
  return count(
    perGame.length >= 3
      ? total - Math.max(...perGame) - Math.min(...perGame)
      : total,
  );
};

const opponents = (tally: Tally, entry: Id, of: (other: Id) => Rational) =>
  sum(playedOf(tally, entry).flatMap((g) => g.others.map(of)));

const teamPoints = (tally: Tally, entry: Id) =>
  tally.format.outcome === 'ranking' && tally.format.of === 'sides'
    ? count(
        countedGames(tally, entry).reduce(
          (s, g) => s + (g.place === null ? 0 : Math.max(0, 4 - g.place)),
          0,
        ),
      )
    : winsTotal(tally, entry);

const countBack = (tally: Tally, entry: Id) =>
  Array.from({ length: 7 }, (_, i) =>
    count(countedGames(tally, entry).filter((g) => g.place === i + 1).length),
  );

const worstDropped = (tally: Tally, entry: Id) => {
  const ranks = ranksOf(tally, entry);
  const total = ranks.reduce((s, r) => s + r, 0);
  return count(ranks.length >= 2 ? total - Math.max(...ranks) : total);
};

const ratingOf = (tally: Tally, entry: Id): Rational[] => {
  const held = tally.ratings?.get(entry);
  return held?.status === 'rated'
    ? [rational(1), rational(held.rating)]
    : [zero];
};

type TotalMetric = Exclude<
  Metric,
  'win_percentage' | 'head_to_head' | 'rating'
>;
const isTotal = (metric: Metric): metric is TotalMetric => metric in totals;

const rankTruncated = (tally: Tally, entry: Id) =>
  count(
    countedGames(tally, entry)
      .flatMap((g) => g.ballots.map((b) => Math.min(b.rank, g.cap)))
      .reduce((s, r) => s + r, 0),
  );

/** Each total before any `own_average` scaling; the record type makes the list exhaustive. */
const totals: Record<TotalMetric, (tally: Tally, entry: Id) => Rational[]> = {
  wins: (t, e) => [winsTotal(t, e)],
  ballot_count: (t, e) => [
    count(
      countedGames(t, e)
        .flatMap((g) => g.ballots)
        .filter((b) => b.won).length,
    ),
  ],
  total_points: (t, e) => [pointsTotal(t, e)],
  high_low_points: (t, e) => [highLow(t, e)],
  opponent_wins: (t, e) => [
    opponents(t, e, (o) => metricValue(t, o, 'wins')[0]!),
  ],
  opponent_points: (t, e) => [
    opponents(t, e, (o) => metricValue(t, o, 'total_points')[0]!),
  ],
  cumulative_rank: (t, e) => [count(ranksOf(t, e).reduce((s, r) => s + r, 0))],
  reciprocals: (t, e) => [
    sum(ranksOf(t, e).flatMap((r) => (r > 0 ? [rational(1, r)] : []))),
  ],
  team_points: (t, e) => [teamPoints(t, e)],
  count_back: (t, e) => countBack(t, e),
  rank_truncation: (t, e) => [rankTruncated(t, e)],
  worst_rank_drop: (t, e) => [worstDropped(t, e)],
};

/**
 * An entry's value of a metric, compared lexicographically. `head_to_head`
 * belongs to a tied group, not to one entry, so it has no value here.
 */
export const metricValue = (
  tally: Tally,
  entry: Id,
  metric: Metric,
): Rational[] => {
  if (metric === 'win_percentage') {
    const games = gamesCount(tally, entry);
    const wins = metricValue(tally, entry, 'wins')[0]!;
    return [games === 0 ? zero : rational(wins.n, wins.d * games)];
  }
  if (metric === 'rating') return ratingOf(tally, entry);
  if (metric === 'head_to_head') return [];
  if (!isTotal(metric)) return [];
  const scale = byeScale(tally, entry);
  return totals[metric](tally, entry).map((v) => multiply(v, scale));
};

/** How many of their meetings `entry` won against `other`, and whether they met at all. */
export const meetings = (tally: Tally, entry: Id, other: Id) => {
  const met = playedOf(tally, entry).filter((g) => g.others.includes(other));
  return {
    met: met.length > 0,
    won: met.filter((g) => g.beat.includes(other)).length,
  };
};
