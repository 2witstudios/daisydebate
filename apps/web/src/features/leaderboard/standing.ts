/**
 * A debater's line on one season's ladder: the shape of a `ratings` row with
 * its `rating_changes` ledger already summed (ADR 0029). Provisional status
 * and rank are derived for display, never stored. Debaters have no tiers.
 */
export type LadderEntry = {
  /** Application id (cuid2); never shown. */
  readonly id: string;
  /** Null once the account is deleted: the row keeps its rating (tombstone). */
  readonly username: string | null;
  readonly rating: number;
  /** Rating deviation; the 95% range is twice this. */
  readonly deviation: number;
  readonly played: number;
  readonly wins: number;
  /** Rating change over the last seven days (a live season's movement). */
  readonly weekChange: number;
  /** Rating change over the whole season (a closed season's movement). */
  readonly seasonChange: number;
};

/**
 * Ranked debates before a rating is established. A sample display rule, not
 * a stored flag (ADR 0029 item 5): the owner sets the real threshold.
 */
export const PROVISIONAL_AFTER = 10;

const isProvisional = (entry: LadderEntry): boolean =>
  entry.played < PROVISIONAL_AFTER;

export type RankedEntry = LadderEntry & {
  /** One-based, established debaters only. */
  readonly rank: number | null;
  readonly provisional: boolean;
  readonly losses: number;
};

/** Higher rating first; the id breaks a tie so the order never flickers. */
const byStanding = (a: LadderEntry, b: LadderEntry): number =>
  b.rating - a.rating || a.id.localeCompare(b.id);

/**
 * Everyone in rating order. Only established debaters get a rank, counted
 * among themselves, so a lucky provisional start is never a headline.
 */
export function rankEntries(
  entries: readonly LadderEntry[],
): readonly RankedEntry[] {
  let rank = 0;
  return [...entries].sort(byStanding).map((entry) => {
    const provisional = isProvisional(entry);
    if (!provisional) rank += 1;
    return {
      ...entry,
      rank: provisional ? null : rank,
      provisional,
      losses: entry.played - entry.wins,
    };
  });
}
