import type { LibraryItem } from './library-item';
import { itemSubtitle } from './library-item';
import type { LibraryQuery, LibrarySort, LibraryView } from './library-query';

const kindOfView: Readonly<Record<LibraryView, LibraryItem['kind'] | null>> = {
  all: null,
  briefs: 'brief',
  cards: 'card',
  cases: 'case',
};

/** Searched words: titles, tags, the subtitle line, plus passages in text mode. */
const haystack = (item: LibraryItem, scope: LibraryQuery['in']): string =>
  [
    item.title,
    item.tags.join(' '),
    itemSubtitle(item),
    scope === 'text' && item.kind === 'card' ? item.passage : '',
  ]
    .join(' ')
    .toLowerCase();

const matchesSearch = (item: LibraryItem, query: LibraryQuery): boolean =>
  query.q === '' || haystack(item, query.in).includes(query.q.toLowerCase());

const hasSide = (item: LibraryItem, side: LibraryQuery['side']): boolean =>
  side === 'any' || (item.kind !== 'card' && item.side === side);

const hasMotion = (item: LibraryItem, motion: string): boolean =>
  motion === '' || (item.kind !== 'card' && item.motion === motion);

const hasSource = (item: LibraryItem, source: string): boolean =>
  source === '' || (item.kind === 'card' && item.outlet === source);

/**
 * A side, motion or source filter keeps only items that carry that field:
 * a card has no side or motion, a brief or case has no source.
 */
const matchesFilters = (item: LibraryItem, query: LibraryQuery): boolean =>
  (query.tag === '' || item.tags.includes(query.tag)) &&
  hasSide(item, query.side) &&
  hasMotion(item, query.motion) &&
  hasSource(item, query.source);

export type ViewCounts = Readonly<Record<LibraryView, number>>;

/** Items matching search and filters, ignoring the view tab. */
export const matching = (
  items: readonly LibraryItem[],
  query: LibraryQuery,
): readonly LibraryItem[] =>
  items.filter(
    (item) => matchesSearch(item, query) && matchesFilters(item, query),
  );

/** Items matching the search alone: what the filters are hiding from. */
export const matchingSearch = (
  items: readonly LibraryItem[],
  query: LibraryQuery,
): readonly LibraryItem[] => items.filter((item) => matchesSearch(item, query));

export function viewCounts(items: readonly LibraryItem[]): ViewCounts {
  const count = (kind: LibraryItem['kind']) =>
    items.filter((item) => item.kind === kind).length;
  return {
    all: items.length,
    briefs: count('brief'),
    cards: count('card'),
    cases: count('case'),
  };
}

export function inView(
  items: readonly LibraryItem[],
  view: LibraryView,
): readonly LibraryItem[] {
  const kind = kindOfView[view];
  return kind === null ? items : items.filter((item) => item.kind === kind);
}

const byTitle = (a: LibraryItem, b: LibraryItem) =>
  a.title.localeCompare(b.title);

/** Recently edited, title, or most used; ties fall back to the title. */
export function sortItems(
  items: readonly LibraryItem[],
  sort: LibrarySort,
): readonly LibraryItem[] {
  const compare: Readonly<
    Record<LibrarySort, (a: LibraryItem, b: LibraryItem) => number>
  > = {
    recent: (a, b) =>
      Date.parse(b.editedAt) - Date.parse(a.editedAt) || byTitle(a, b),
    title: byTitle,
    used: (a, b) => b.usedIn - a.usedIn || byTitle(a, b),
  };
  return [...items].sort(compare[sort]);
}

/** The most recently opened items, newest first. */
export const recentlyOpened = (
  items: readonly LibraryItem[],
  count: number,
): readonly LibraryItem[] =>
  [...items]
    .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt))
    .slice(0, count);

/** The distinct choices a filter select offers, sorted. */
export function filterOptions(items: readonly LibraryItem[]) {
  const unique = (values: readonly string[]) =>
    [...new Set(values)].sort((a, b) => a.localeCompare(b));
  return {
    tags: unique(items.flatMap((item) => item.tags)),
    motions: unique(
      items.flatMap((item) => (item.kind === 'card' ? [] : [item.motion])),
    ),
    sources: unique(
      items.flatMap((item) => (item.kind === 'card' ? [item.outlet] : [])),
    ),
  };
}
