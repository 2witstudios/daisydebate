import type { EntryRating } from '../shapes/competition';

/** An integer quotient rounded half to even, exactly. */
const roundHalfEven = (total: number, count: number) => {
  const remainder = ((total % count) + count) % count;
  const floor = (total - remainder) / count;
  const twice = 2 * remainder;
  if (twice < count) return floor;
  if (twice > count) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
};

/**
 * A team's rating: the mean of its members' ratings and of their
 * deviations, each rounded half to even. A team is rated only when every
 * member is; an empty team is unrated.
 */
export const entryRating = (members: readonly EntryRating[]): EntryRating => {
  const rated = members.flatMap((m) => (m.status === 'rated' ? [m] : []));
  if (members.length === 0 || rated.length !== members.length)
    return { status: 'unrated' };
  return {
    status: 'rated',
    rating: roundHalfEven(
      rated.reduce((s, m) => s + m.rating, 0),
      rated.length,
    ),
    deviation: roundHalfEven(
      rated.reduce((s, m) => s + m.deviation, 0),
      rated.length,
    ),
  };
};
