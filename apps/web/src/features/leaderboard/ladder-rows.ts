import { debaterHref, type LadderQuery, type LadderStatus } from './query';
import type { Change, LadderRow, LadderViewer } from './ladder-view';
import { isClosed, type Season } from './season';
import type { RatingEntry, RankedRatingEntry } from '../ratings/rank';

/** Rows shown either side of the viewer in "Around me". */
const AROUND = 5;

const change = (entry: RatingEntry, closed: boolean): Change => {
  const amount = closed ? entry.seasonChange : entry.weekChange;
  if (amount === 0) return { kind: 'flat', amount: 0 };
  return { kind: amount > 0 ? 'up' : 'down', amount: Math.abs(amount) };
};

const needle = (q: string): string => q.toLowerCase().replace(/^@/, '');

export const matchesSearch = (entry: RankedRatingEntry, q: string): boolean =>
  q === '' || entry.username.toLowerCase().includes(needle(q));

/** The entries that satisfy the status filter and the search. */
export const applyFilters = (
  ranked: readonly RankedRatingEntry[],
  query: LadderQuery,
  status: LadderStatus,
): readonly RankedRatingEntry[] =>
  ranked.filter(
    (entry) =>
      (status === 'everyone' ||
        (status === 'established') === !entry.provisional) &&
      matchesSearch(entry, query.q),
  );

/** True when a search or a status filter is set. */
export const hasFilters = (query: LadderQuery): boolean =>
  query.q !== '' || query.status !== 'established';

export type RowContext = {
  readonly season: Season;
  readonly query: LadderQuery;
  readonly viewer: LadderViewer | null;
  readonly mine: RankedRatingEntry | undefined;
};

/**
 * One entry as a row. A judged debater's numbers never leave this function,
 * so no screen can show them by mistake.
 */
export function toRow(
  entry: RankedRatingEntry,
  context: RowContext,
): LadderRow {
  const { query, viewer, mine } = context;
  const masked = (viewer?.blinded ?? []).includes(entry.username);
  const base = {
    key: entry.id,
    username: entry.username,
    accountClosed: entry.accountClosed,
    me: mine !== undefined && entry.id === mine.id,
    selected: entry.username === query.debater,
    href: debaterHref(query, entry.username),
    masked,
  };
  if (masked)
    return {
      ...base,
      rank: null,
      rating: 0,
      range: 0,
      provisional: false,
      wins: 0,
      losses: 0,
      change: { kind: 'none' },
    };
  return {
    ...base,
    rank: entry.rank,
    rating: Math.round(entry.rating),
    range: Math.round(2 * entry.deviation),
    provisional: entry.provisional,
    wins: entry.wins,
    losses: entry.losses,
    change: entry.provisional
      ? { kind: 'none' }
      : change(entry, isClosed(context.season)),
  };
}

/** The eleven-row window around the viewer, and its note. */
export function aroundWindow(
  ranked: readonly RankedRatingEntry[],
  mine: RankedRatingEntry,
): { readonly shown: readonly RankedRatingEntry[]; readonly note: string } {
  // A provisional viewer has no rank to center on: their window trails the
  // established field, at the rank they would enter once established.
  const window = mine.provisional
    ? [...ranked.filter((entry) => !entry.provisional), mine]
    : ranked.filter((entry) => !entry.provisional || entry === mine);
  const at = window.indexOf(mine);
  const shown = window.slice(Math.max(0, at - AROUND), at + AROUND + 1);
  return {
    shown,
    note: mine.provisional
      ? `Where you would sit: around rank ${at + 1} at rating ${Math.round(mine.rating)}`
      : `Ranks ${shown[0]?.rank ?? ''} to ${shown.at(-1)?.rank ?? ''}`,
  };
}
