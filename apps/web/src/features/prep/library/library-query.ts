import { z } from 'zod';
import type { SearchParams } from '../../access/decision';

const views = ['all', 'briefs', 'cards', 'cases'] as const;
const sides = ['any', 'aff', 'neg'] as const;
const scopes = ['titles', 'text'] as const;
export const librarySorts = ['recent', 'title', 'used'] as const;

export type LibraryView = (typeof views)[number];
type SideFilter = (typeof sides)[number];
type SearchScope = (typeof scopes)[number];
export type LibrarySort = (typeof librarySorts)[number];

/** The library's whole state, as it appears in the URL. */
export type LibraryQuery = {
  readonly view: LibraryView;
  readonly q: string;
  /** Empty string is any tag, motion or source. */
  readonly tag: string;
  readonly side: SideFilter;
  readonly motion: string;
  readonly source: string;
  readonly in: SearchScope;
  readonly sort: LibrarySort;
};

export const defaultLibraryQuery: LibraryQuery = {
  view: 'all',
  q: '',
  tag: '',
  side: 'any',
  motion: '',
  source: '',
  in: 'titles',
  sort: 'recent',
};

/** Longest value the library reads from one field. */
export const MAX_FIELD_LENGTH = 80;

const text = z
  .string()
  .transform((value) => value.trim().slice(0, MAX_FIELD_LENGTH).trim());

// Every field falls back to its default on any bad value, so untrusted
// parameters can never make parsing throw.
const schema = z.object({
  view: z.enum(views).catch(defaultLibraryQuery.view),
  q: text.catch(defaultLibraryQuery.q),
  tag: text.catch(defaultLibraryQuery.tag),
  side: z.enum(sides).catch(defaultLibraryQuery.side),
  motion: text.catch(defaultLibraryQuery.motion),
  source: text.catch(defaultLibraryQuery.source),
  in: z.enum(scopes).catch(defaultLibraryQuery.in),
  sort: z.enum(librarySorts).catch(defaultLibraryQuery.sort),
});

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

/** Reads the library's URL state; bad or missing values become defaults. */
export function parseLibraryQuery(params: SearchParams): LibraryQuery {
  return schema.parse(
    Object.fromEntries(
      (Object.keys(defaultLibraryQuery) as (keyof LibraryQuery)[]).map(
        (key) => [key, first(params[key])],
      ),
    ),
  );
}

/** The library URL for a query, carrying only the non-default values. */
export function libraryHref(query: LibraryQuery): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(defaultLibraryQuery) as (keyof LibraryQuery)[])
    if (query[key] !== defaultLibraryQuery[key]) params.set(key, query[key]);
  const search = params.toString();
  return search === '' ? '/prep' : `/prep?${search}`;
}

/** Filters reset; the view and sort stay. */
const withoutFilters = (query: LibraryQuery): LibraryQuery => ({
  ...query,
  tag: '',
  side: 'any',
  motion: '',
  source: '',
});

export const clearFiltersHref = (query: LibraryQuery): string =>
  libraryHref(withoutFilters(query));

/** Drops the search and every filter; the view and sort stay. */
export const clearSearchHref = (query: LibraryQuery): string =>
  libraryHref({ ...withoutFilters(query), q: '', in: 'titles' });

/** True when a tag, side, motion or source filter is set. */
export const hasFilters = (query: LibraryQuery): boolean =>
  libraryHref(withoutFilters(query)) !== libraryHref(query);

/** Number of the four select filters that are set (the phone badge). */
export const activeFilterCount = (query: LibraryQuery): number =>
  [
    query.tag !== '',
    query.side !== 'any',
    query.motion !== '',
    query.source !== '',
  ].filter(Boolean).length;

/** Filter chips: a label and the URL that removes just that filter. */
export function filterChips(
  query: LibraryQuery,
): readonly { readonly label: string; readonly removeHref: string }[] {
  const chips: { label: string; removeHref: string }[] = [];
  const drop = (patch: Partial<LibraryQuery>) =>
    libraryHref({ ...query, ...patch });
  if (query.side !== 'any')
    chips.push({
      label: `Side: ${query.side === 'aff' ? 'Aff' : 'Neg'}`,
      removeHref: drop({ side: 'any' }),
    });
  if (query.tag !== '')
    chips.push({ label: `Tag: ${query.tag}`, removeHref: drop({ tag: '' }) });
  if (query.motion !== '')
    chips.push({
      label: `Motion: ${query.motion}`,
      removeHref: drop({ motion: '' }),
    });
  if (query.source !== '')
    chips.push({
      label: `Source: ${query.source}`,
      removeHref: drop({ source: '' }),
    });
  return chips;
}
