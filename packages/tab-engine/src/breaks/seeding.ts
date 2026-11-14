import { canonicalOrder } from '@daisy/seeded-random';
import type { Entry, EntryRating, Id } from '../shapes/competition';
import type {
  BreaksInput,
  BreakStage,
  Rational,
  StandingsInput,
} from '../shapes/folds';
import { drawLots } from '../standings/lot';
import { metricValue } from '../standings/metric-value';
import { standings } from '../standings/standings';
import { tallyOf } from '../standings/tally';

/** A candidate in seed order, with the wins a record line reads. */
export type Seeded = { readonly entry: Id; readonly wins: Rational };

/** Break-eligible active entries of the stage's division, or of the event when it has none. */
export const candidatesOf = (
  input: BreaksInput,
  stage: BreakStage,
): readonly Entry[] =>
  canonicalOrder(input.entries).filter(
    (e) =>
      e.status === 'active' &&
      e.breakEligible &&
      (stage.division === null || e.division === stage.division),
  );

/** Rated by rating (higher first), then deviation (lower first); unrated after every rated entry. */
const ratingKey = (rating: EntryRating | undefined) =>
  rating?.status === 'rated' ? `r:${rating.rating}:${rating.deviation}` : 'u';

const compareRatings = (
  a: EntryRating | undefined,
  b: EntryRating | undefined,
) => {
  if (a?.status === 'rated' && b?.status === 'rated')
    return b.rating - a.rating || a.deviation - b.deviation;
  return (a?.status === 'rated' ? 0 : 1) - (b?.status === 'rated' ? 0 : 1);
};

const byRating = (input: BreaksInput, candidates: readonly Entry[]): Id[] => {
  const ratings = new Map(
    input.ratings?.entries.map((r) => [r.entry, r as EntryRating]) ?? [],
  );
  const sorted = [...candidates].sort((a, b) =>
    compareRatings(ratings.get(a.id), ratings.get(b.id)),
  );
  const groups: Id[][] = [];
  sorted.forEach((e, i) => {
    const same =
      i > 0 &&
      ratingKey(ratings.get(sorted[i - 1]!.id)) ===
        ratingKey(ratings.get(e.id));
    if (same) groups[groups.length - 1]!.push(e.id);
    else groups.push([e.id]);
  });
  return groups.flatMap((group) =>
    group.length > 1
      ? drawLots('daisy-tab-v1/breaks/lot', input.seed, group)
      : group,
  );
};

/**
 * The stage's candidates in seed order: by the division's standings, whose
 * unranked rows (below the minimum games) cannot break, or by the rating
 * snapshot with a seeded lot among equal ratings.
 */
export const seedOrder = (
  input: BreaksInput,
  stage: BreakStage,
  candidates: readonly Entry[],
): Seeded[] => {
  const standingsInput = {
    ...input,
    entries: candidates,
    division: stage.division,
  } as StandingsInput;
  const tally = tallyOf(standingsInput);
  const order =
    input.settings['break.seeding'].value === 'rating'
      ? byRating(input, candidates)
      : standings(standingsInput).rows.flatMap((r) =>
          r.rank === null ? [] : [r.entry],
        );
  return order.map((entry) => ({
    entry,
    wins: metricValue(tally, entry, 'wins')[0]!,
  }));
};
