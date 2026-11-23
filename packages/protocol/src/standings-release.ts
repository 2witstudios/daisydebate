/** A current rating projection row, by season and debater. */
type StandingProjection = {
  readonly seasonId: string;
  readonly actorId: string;
  readonly rating: number;
  readonly deviation: number;
  readonly volatility: number;
};

/** One ledger posting, and whether its Round's result is released yet. */
type ReleasablePosting = {
  readonly seasonId: string;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly ratingBefore: number;
  readonly deviationBefore: number;
  readonly volatilityBefore: number;
  readonly released: boolean;
};

const scopeOf = (row: {
  readonly seasonId: string;
  readonly actorId: string;
}) => `${row.seasonId}:${row.actorId}`;

/**
 * The ledger is the only history a rating has, so a rating the audience may
 * not know yet is rebuilt from it: it stands where the earliest unreleased
 * posting found it. A debater with no released posting is not on the ladder.
 */
export const releasedStandings = <
  Rating extends StandingProjection,
  Posting extends ReleasablePosting,
>(read: {
  readonly ratings: readonly Rating[];
  readonly changes: readonly Posting[];
  /** An authorized Round can use its competitors' stored state for stakes. */
  readonly includeUnposted?: boolean;
}): {
  readonly ratings: readonly Rating[];
  readonly changes: readonly Omit<Posting, 'released' | 'volatilityBefore'>[];
} => {
  const earliest = new Map<string, Posting>();
  const known = new Set<string>();
  for (const change of read.changes) {
    const scope = scopeOf(change);
    if (
      !change.released &&
      (earliest.get(scope)?.occurredAt ?? '~') > change.occurredAt
    )
      earliest.set(scope, change);
  }
  const visible = (change: Posting) =>
    change.released &&
    change.occurredAt < (earliest.get(scopeOf(change))?.occurredAt ?? '~');
  for (const change of read.changes)
    if (visible(change)) known.add(scopeOf(change));
  return {
    ratings: read.ratings.flatMap((row) => {
      const scope = scopeOf(row);
      const held = earliest.get(scope);
      if (!held) return known.has(scope) || read.includeUnposted ? [row] : [];
      if (!known.has(scope)) return [];
      return [
        {
          ...row,
          rating: held.ratingBefore,
          deviation: held.deviationBefore,
          volatility: held.volatilityBefore,
        },
      ];
    }),
    changes: read.changes
      .filter(visible)
      .map(
        ({ released: _released, volatilityBefore: _volatility, ...change }) =>
          change,
      ),
  };
};
