import { z } from 'zod';
import type { SearchParams } from '../access/decision';

/** Tabs, modes, sorts and rating ranges as they appear in the URL. */
const lobbyTabs = ['all', 'open', 'live'] as const;
const lobbyModes = ['any', 'ranked', 'casual'] as const;
export const lobbySorts = [
  'closest',
  'high',
  'low',
  'waiting',
  'newest',
  'watched',
] as const;
/** "Within N of me"; 0 is any rating. */
export const lobbyRanges = [0, 100, 200, 300] as const;

export type LobbyTab = (typeof lobbyTabs)[number];
export type LobbyMode = (typeof lobbyModes)[number];
export type LobbySort = (typeof lobbySorts)[number];
type LobbyRange = (typeof lobbyRanges)[number];

export type LobbyQuery = {
  readonly tab: LobbyTab;
  readonly mode: LobbyMode;
  readonly q: string;
  readonly range: LobbyRange;
  readonly sort: LobbySort;
};

export const defaultQuery: LobbyQuery = {
  tab: 'all',
  mode: 'any',
  q: '',
  range: 0,
  sort: 'closest',
};

/** Longest search the lobby reads; the form's maxlength matches. */
export const MAX_SEARCH_LENGTH = 80;

// Every field falls back to its default on any bad value, so untrusted
// parameters can never make parsing throw.
const querySchema = z.object({
  tab: z.enum(lobbyTabs).catch(defaultQuery.tab),
  mode: z.enum(lobbyModes).catch(defaultQuery.mode),
  q: z
    .string()
    .transform((value) => value.trim().slice(0, MAX_SEARCH_LENGTH).trim())
    .catch(defaultQuery.q),
  range: z
    .enum(lobbyRanges.map(String) as [string, ...string[]])
    .transform((value) => Number(value) as LobbyRange)
    .catch(defaultQuery.range),
  sort: z.enum(lobbySorts).catch(defaultQuery.sort),
});

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

/** Reads the lobby's URL state; bad or missing values become defaults. */
export function parseLobbyQuery(params: SearchParams): LobbyQuery {
  return querySchema.parse({
    tab: first(params['tab']),
    mode: first(params['mode']),
    q: first(params['q']),
    range: first(params['range']),
    sort: first(params['sort']),
  });
}

/** The lobby URL for a query, carrying only the non-default values. */
export function lobbyHref(query: LobbyQuery): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(defaultQuery) as (keyof LobbyQuery)[]) {
    if (query[key] !== defaultQuery[key]) params.set(key, String(query[key]));
  }
  const search = params.toString();
  return search === '' ? '/lobby' : `/lobby?${search}`;
}

/** Filters reset to their defaults; the tab and sort stay. */
const withoutFilters = (query: LobbyQuery): LobbyQuery => ({
  ...query,
  mode: defaultQuery.mode,
  q: defaultQuery.q,
  range: defaultQuery.range,
});

export const clearFiltersHref = (query: LobbyQuery): string =>
  lobbyHref(withoutFilters(query));

/** True when any filter (not tab or sort) differs from its default. */
export const isFiltered = (query: LobbyQuery): boolean =>
  lobbyHref(withoutFilters(query)) !== lobbyHref(query);

/** Filters living in the phone panel: search has its own field. */
export const activeFilterCount = (query: LobbyQuery): number =>
  [query.mode !== defaultQuery.mode, query.range !== defaultQuery.range].filter(
    Boolean,
  ).length;
