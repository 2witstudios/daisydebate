import { signed } from './history';
import type { Change, LadderRow } from './ladder-view';
import { markedRating } from '../ratings/provisional-mark';

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

/** The name a row shows: the username, marked when the account is closed. */
export const displayName = (
  row: Pick<LadderRow, 'username' | 'accountClosed'>,
): string => `@${row.username}${row.accountClosed ? ' (closed)' : ''}`;

export const recordText = (row: Pick<LadderRow, 'wins' | 'losses'>): string =>
  `${row.wins}–${row.losses}`;

/** The rating as a row shows it: a star while provisional. */
export const ratingText = (
  row: Pick<LadderRow, 'rating' | 'provisional' | 'masked'>,
): string =>
  row.masked ? 'Hidden' : markedRating(row.rating, row.provisional);

export const rankText = (row: Pick<LadderRow, 'rank'>): string =>
  row.rank === null ? '–' : String(row.rank);

/** The row's accessible name: who, where they stand and their rating. */
export function rowLabel(row: LadderRow): string {
  const who = displayName(row);
  if (row.masked) return `${who}, rating hidden while you judge`;
  return row.provisional
    ? `${who}, provisional, rating ${row.rating}`
    : `${who}, rank ${row.rank}, rating ${row.rating}`;
}
