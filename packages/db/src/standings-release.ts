import type {
  StandingChange,
  StandingRating,
  StandingsRead,
} from './standings';

export type ReleasableChange = StandingChange & {
  readonly released: boolean;
  readonly volatilityBefore: number;
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
export const releasedStandings = (read: {
  readonly ratings: readonly StandingRating[];
  readonly changes: readonly ReleasableChange[];
}): StandingsRead => {
  const earliest = new Map<string, ReleasableChange>();
  const known = new Set<string>();
  for (const change of read.changes) {
    const scope = scopeOf(change);
    if (change.released) known.add(scope);
    else if ((earliest.get(scope)?.occurredAt ?? '~') > change.occurredAt)
      earliest.set(scope, change);
  }
  return {
    ratings: read.ratings.flatMap((row) => {
      const scope = scopeOf(row);
      const held = earliest.get(scope);
      if (!held) return [row];
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
    changes: read.changes.flatMap(
      ({ released, volatilityBefore: _volatility, ...change }) =>
        released ? [change] : [],
    ),
  };
};
