import { hasFilters, type LibraryQuery } from './library-query';

const sortPhrase = {
  recent: 'newest first',
  title: 'by title',
  used: 'most used first',
} as const;

/** "11 items, newest first" on All; "2 cards" on a kind tab. */
export function resultsLine(query: LibraryQuery, count: number): string {
  if (query.view === 'all')
    return `${count} ${count === 1 ? 'item' : 'items'}, ${sortPhrase[query.sort]}`;
  const noun = query.view.slice(0, -1);
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

export type EmptyKind = 'no-results' | 'filters-hide' | 'none-in-view';

/**
 * Why a listing is empty: the search finds nothing at all, the filters hide
 * what the search found, or the tab simply has nothing yet.
 */
export function emptyKind(
  query: LibraryQuery,
  searchMatches: number,
): EmptyKind {
  if (query.q !== '' && searchMatches === 0) return 'no-results';
  return hasFilters(query) || query.q !== '' ? 'filters-hide' : 'none-in-view';
}
