import { bloomBand, type Bloom } from './bloom';

export type Region =
  'americas' | 'europe' | 'asia-pacific' | 'africa-middle-east';

export const regions: readonly Region[] = [
  'americas',
  'europe',
  'asia-pacific',
  'africa-middle-east',
];

const regionLabels: Readonly<Record<Region, string>> = {
  americas: 'Americas',
  europe: 'Europe',
  'asia-pacific': 'Asia-Pacific',
  'africa-middle-east': 'Africa and Middle East',
};

export const regionLabel = (region: Region): string => regionLabels[region];

/**
 * A debater's line on one season's ladder: the shape of a `ratings` row with
 * its `rating_changes` ledger already summed (ADR 0029). Provisional status,
 * rank and band are derived for display, never stored.
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
  /** Only when the debater chose to show one (proposed, ADR 0036). */
  readonly region: Region | null;
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
  readonly bloom: Bloom;
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
      bloom: provisional ? 'provisional' : bloomBand(entry.rating),
      losses: entry.played - entry.wins,
    };
  });
}
