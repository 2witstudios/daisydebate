import { daisyLadders, type RatingDivision } from '@daisy/protocol';
import { ladderLabel } from '../../features/ratings/ladder-labels';

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
