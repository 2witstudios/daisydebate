import { daisyLadders, type RatingDivision } from '@daisy/protocol';
import { ladderLabel } from '../../features/ratings/ladder-labels';
import type { MemberStanding } from '../../features/ratings/read-member';
import { markedRating } from '../../features/ratings/provisional-mark';

/** The ladder words Home's notes carry; null keeps a note's own words. */
export type HomeLadder = {
  readonly playCaption: string | null;
  readonly leaderboardTagline: string | null;
};

/** Home's ladder words for a member on `division`. */
export const homeLadderOf = (
  standings: readonly MemberStanding[],
  division: RatingDivision | null,
): HomeLadder => ({
  playCaption: playCaption(standings, division),
  leaderboardTagline: leaderboardTagline(division),
});

/**
 * The Play note's caption (ADR 0147): the member's own ladder and this
 * season's rating, "Youth – Freestyle · 1526"; the ladder alone while
 * unrated or hidden. Null without a ladder.
 */
export function playCaption(
  standings: readonly MemberStanding[],
  division: RatingDivision | null,
): string | null {
  if (division === null) return null;
  const own = standings.find((s) => s.ladder.division === division);
  const label = ladderLabel(own?.ladder ?? { style: 'freestyle', division });
  return own && own.current && own.rating !== null && !own.hidden
    ? `${label} · ${markedRating(own.rating, own.provisional)}`
    : label;
}

/**
 * The Leaderboard note's tagline: every ladder by name, the member's own
 * first, "Youth – Freestyle and Open – Freestyle ladders."
 */
export function leaderboardTagline(division: RatingDivision | null): string {
  const names = daisyLadders
    .slice()
    .sort(
      (a, b) =>
        Number(b.division === (division ?? 'youth')) -
        Number(a.division === (division ?? 'youth')),
    )
    .map(ladderLabel);
  return `${names.join(' and ')} ladders.`;
}
