import { ratingClassification } from './standing';
/**
 * A debater's line on one season's ladder: the shape of a `ratings` row with
 * its `rating_changes` ledger already summed (ADR 0029). Provisional status
 * and rank are derived for display, never stored. Debaters have no tiers.
 */
export type RatingEntry = {
  /** Application id (cuid2); never shown. */
  readonly id: string;
  readonly username: string;
  /** The account is closed: the row keeps its name and rating (ADR 0087). */
  readonly accountClosed: boolean;
  readonly rating: number;
  /** Rating deviation; the 95% range is twice this. */
  readonly deviation: number;
  readonly played: number;
  readonly wins: number;
  readonly draws: number;
  /** Rating change over the last seven days (a live season's movement). */
  readonly weekChange: number;
  /** Rating change over the whole season (a closed season's movement). */
  readonly seasonChange: number;
};

export type RankedRatingEntry = RatingEntry & {
  /** One-based, established debaters only. */
  readonly rank: number | null;
  readonly provisional: boolean;
  readonly losses: number;
};

/** Higher rating first; the id breaks a tie so the order never flickers. */
const byStanding = (a: RatingEntry, b: RatingEntry): number =>
  b.rating - a.rating || a.id.localeCompare(b.id);

/**
 * Everyone in rating order. Only established debaters get a rank, counted
 * among themselves, so a lucky provisional start is never a headline.
 */
export function rankRatingEntries(
  entries: readonly RatingEntry[],
): readonly RankedRatingEntry[] {
  let rank = 0;
  return [...entries].sort(byStanding).map((entry) => {
    const provisional = ratingClassification(entry.deviation) === 'provisional';
    if (!provisional) rank += 1;
    return {
      ...entry,
      rank: provisional ? null : rank,
      provisional,
      losses: entry.played - entry.wins - entry.draws,
    };
  });
}
