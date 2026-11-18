import type { RatingDivision } from '@daisy/protocol';
import { styleLabels } from '../../features/ratings/ladder-labels';
import { rankedRoomLadder } from '../../features/play/ladder-division-words';
import type { MemberStanding } from '../../features/ratings/read-member';
import { markedRating } from '../../features/ratings/provisional-mark';

/** The ladder words Home's Play note carries; null keeps its own words. */
export type HomeLadder = {
  readonly playCaption: string | null;
};

/** Home's ladder words for a member on `division`. */
export const homeLadderOf = (
  standings: readonly MemberStanding[],
  division: RatingDivision | null,
): HomeLadder => ({ playCaption: playCaption(standings, division) });

/**
 * The Play note's caption (ADR 0156): the member's own ladder by its style
 * and this season's rating, "Freestyle · 1526", naming no division; the style
 * alone while unrated or hidden. Null without a ladder.
 */
export function playCaption(
  standings: readonly MemberStanding[],
  division: RatingDivision | null,
): string | null {
  if (division === null) return null;
  const own = standings.find((s) => s.ladder.division === division);
  const label = styleLabels[(own?.ladder ?? rankedRoomLadder(division)).style];
  return own && own.current && own.rating !== null && !own.hidden
    ? `${label} · ${markedRating(own.rating, own.provisional)}`
    : label;
}
