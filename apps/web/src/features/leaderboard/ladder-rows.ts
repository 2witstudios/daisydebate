import {
  debaterHref,
  ladderHref,
  type LadderQuery,
  type LadderStatus,
} from './query';
import type { Change, LadderRow, LadderViewer, Pinned } from './ladder-view';
import { isClosed, type Season } from './season';
import {
  PROVISIONAL_AFTER,
  type LadderEntry,
  type RankedEntry,
} from './standing';
import { PAGE_SIZE } from './ladder-view';

/** Rows shown either side of the viewer in "Around me". */
const AROUND = 5;

const change = (entry: LadderEntry, closed: boolean): Change => {
  const amount = closed ? entry.seasonChange : entry.weekChange;
  if (amount === 0) return { kind: 'flat', amount: 0 };
  return { kind: amount > 0 ? 'up' : 'down', amount: Math.abs(amount) };
};

const needle = (q: string): string => q.toLowerCase().replace(/^@/, '');

export const matchesSearch = (entry: RankedEntry, q: string): boolean =>
  q === '' ||
  (entry.username !== null && entry.username.toLowerCase().includes(needle(q)));

/** The entries that satisfy the status, band, region and search filters. */
export const applyFilters = (
  ranked: readonly RankedEntry[],
  query: LadderQuery,
  status: LadderStatus,
): readonly RankedEntry[] =>
  ranked.filter(
    (entry) =>
      (status === 'everyone' ||
        (status === 'established') === !entry.provisional) &&
      (query.band === 'any' ||
        (!entry.provisional && entry.bloom === query.band)) &&
      (query.region === 'any' || entry.region === query.region) &&
      matchesSearch(entry, query.q),
  );

/** True when a search or a status, band or region filter is set. */
export const hasFilters = (query: LadderQuery): boolean =>
  query.q !== '' ||
  query.status !== 'established' ||
  query.band !== 'any' ||
  query.region !== 'any';

export type RowContext = {
  readonly season: Season;
  readonly query: LadderQuery;
  readonly viewer: LadderViewer | null;
  readonly mine: RankedEntry | undefined;
};

/**
 * One entry as a row. A judged debater's numbers never leave this function,
 * so no screen can show them by mistake.
 */
export function toRow(entry: RankedEntry, context: RowContext): LadderRow {
  const { query, viewer, mine } = context;
  const masked =
    entry.username !== null && (viewer?.blinded ?? []).includes(entry.username);
  const base = {
    key: entry.id,
    username: entry.username,
    me: mine !== undefined && entry.id === mine.id,
    selected: entry.username !== null && entry.username === query.debater,
    href: entry.username === null ? null : debaterHref(query, entry.username),
    masked,
  };
  if (masked)
    return {
      ...base,
      rank: null,
      rating: 0,
      range: 0,
      bloom: 'provisional',
      provisional: false,
      wins: 0,
      losses: 0,
      change: { kind: 'none' },
    };
  return {
    ...base,
    rank: entry.rank,
    rating: entry.rating,
    range: 2 * entry.deviation,
    bloom: entry.bloom,
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
  ranked: readonly RankedEntry[],
  mine: RankedEntry,
): { readonly shown: readonly RankedEntry[]; readonly note: string } {
  const window = ranked.filter((entry) => !entry.provisional || entry === mine);
  const at = window.indexOf(mine);
  const shown = window.slice(Math.max(0, at - AROUND), at + AROUND + 1);
  const above = window.slice(0, at).filter((entry) => !entry.provisional);
  return {
    shown,
    note: mine.provisional
      ? `Where you would sit: around rank ${above.length + 1} at rating ${mine.rating}`
      : `Ranks ${shown[0]?.rank ?? ''} to ${shown.at(-1)?.rank ?? ''}`,
  };
}

/** A link to the page of the ladder that holds the viewer's own row. */
function jumpHref(
  ranked: readonly RankedEntry[],
  entry: RankedEntry,
  query: LadderQuery,
): string {
  const list = ranked.filter((row) => entry.provisional || !row.provisional);
  return ladderHref({
    ...query,
    scope: 'top',
    q: '',
    band: 'any',
    region: 'any',
    status: entry.provisional ? 'everyone' : 'established',
    page: Math.floor(list.indexOf(entry) / PAGE_SIZE) + 1,
    debater: null,
  });
}

/** The viewer's line pinned under the table. */
export function pinnedFor(
  ranked: readonly RankedEntry[],
  context: RowContext,
): Pinned {
  const { viewer, mine, query } = context;
  if (viewer === null) return { kind: 'signed-out' };
  if (!mine) return { kind: 'absent' };
  const row = toRow(mine, context);
  const jump = jumpHref(ranked, mine, query);
  if (!mine.provisional)
    return { kind: 'established', rank: mine.rank ?? 0, row, jumpHref: jump };
  return {
    kind: 'provisional',
    row,
    played: mine.played,
    remaining: PROVISIONAL_AFTER - mine.played,
    percent: Math.round((mine.played / PROVISIONAL_AFTER) * 100),
    wouldRank:
      ranked.filter((e) => !e.provisional && e.rating > mine.rating).length + 1,
    jumpHref: jump,
  };
}
