import type { RatingDivision } from '@daisy/protocol';
import type { MemberStanding } from '../ratings/read-member';

/**
 * The ladder cards a profile shows (ADR 0147): every ladder the member was
 * rated on, this season or kept as history, and their own ladder even while
 * unrated there. A ladder they never played is left out. This season's cards
 * come before history.
 */
export const profileLadders = (
  standings: readonly MemberStanding[],
  ownDivision: RatingDivision | null,
): readonly MemberStanding[] =>
  standings
    .filter(
      (standing) =>
        standing.rating !== null || standing.ladder.division === ownDivision,
    )
    .slice()
    .sort((a, b) => Number(b.current) - Number(a.current));

/**
 * The division a member's ratings say they debate on now: the one ladder they
 * are rated on this season. None or both says nothing.
 */
export const currentDivisionOf = (
  standings: readonly MemberStanding[],
): RatingDivision | null => {
  const divisions = new Set(
    standings
      .filter((standing) => standing.current && standing.rating !== null)
      .map((standing) => standing.ladder.division),
  );
  const [only] = divisions;
  return divisions.size === 1 && only !== undefined ? only : null;
};
