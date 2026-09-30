import { bloomLabel } from './bloom';
import { signed } from './history';
import type { Change, LadderRow } from './ladder-view';

/** A live season shows a seven-day move; a closed one its season change. */
export function changeText(change: Change, closed: boolean): string {
  if (change.kind === 'none') return '–';
  if (closed)
    return change.kind === 'flat'
      ? '0'
      : signed(change.kind === 'up' ? change.amount : -change.amount);
  if (change.kind === 'flat') return '–';
  return `${change.kind === 'up' ? '▲' : '▼'} ${change.amount}`;
}

/** The name a row shows: a username, or the tombstone for a deleted account. */
export const displayName = (row: Pick<LadderRow, 'username'>): string =>
  row.username === null ? '[deleted debater]' : `@${row.username}`;

export const recordText = (row: Pick<LadderRow, 'wins' | 'losses'>): string =>
  `${row.wins}–${row.losses}`;

/** The rating as a row shows it: a question mark while provisional. */
export const ratingText = (
  row: Pick<LadderRow, 'rating' | 'provisional' | 'masked'>,
): string =>
  row.masked ? 'Hidden' : `${row.rating}${row.provisional ? '?' : ''}`;

export const rankText = (row: Pick<LadderRow, 'rank'>): string =>
  row.rank === null ? '–' : String(row.rank);

export const bandText = (row: Pick<LadderRow, 'bloom' | 'masked'>): string =>
  row.masked ? 'Hidden' : bloomLabel(row.bloom);

/** The row's accessible name: who, where they stand and their rating. */
export function rowLabel(row: LadderRow): string {
  const who = row.username === null ? 'Deleted debater' : `@${row.username}`;
  if (row.masked) return `${who}, rating hidden while you judge`;
  return row.provisional
    ? `${who}, provisional, rating ${row.rating}`
    : `${who}, rank ${row.rank}, rating ${row.rating}`;
}
