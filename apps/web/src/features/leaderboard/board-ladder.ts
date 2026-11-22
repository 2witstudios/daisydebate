import type { Ladder, RatingDivision } from '@daisy/protocol/ladder';

/**
 * The ladder the leaderboard and Seasons pages show (ADR 0147): Freestyle in
 * the division asked for, else the viewer's own, else Open.
 */
export const boardLadder = (
  asked: RatingDivision | null,
  viewer: RatingDivision | null,
): Ladder => ({ style: 'freestyle', division: asked ?? viewer ?? 'open' });
