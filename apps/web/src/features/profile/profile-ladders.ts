import type { RatingDivision } from '@daisy/protocol';
import type { MemberStanding } from '../ratings/read-member';

/**
 * The one rating card a profile shows: the ladder the
 * member is rated on this season, or on their own profile their own ladder
 * while unrated. Earlier seasons live in the season history, not as cards.
 */
export const profileLadders = (
  standings: readonly MemberStanding[],
  ownDivision: RatingDivision | null,
): readonly MemberStanding[] => {
  const rated = standings.find(
    (standing) => standing.current && standing.rating !== null,
  );
  const own = standings.find(
    (standing) => standing.current && standing.ladder.division === ownDivision,
  );
  const shown = rated ?? own;
  return shown ? [shown] : [];
};
