import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import { watchRoutes } from './routes';

/** The hub's public tabs: Recordings is its own guarded route. */
const hubTabs = ['live', 'following'] as const;
const modes = ['any', 'ranked', 'casual'] as const;
const sorts = ['watched', 'rated'] as const;

type HubTab = (typeof hubTabs)[number];
type LiveMode = (typeof modes)[number];
type LiveSort = (typeof sorts)[number];

export type LiveQuery = {
  readonly tab: HubTab;
  readonly mode: LiveMode;
  readonly q: string;
  readonly sort: LiveSort;
};

export const defaultLiveQuery: LiveQuery = {
  tab: 'live',
  mode: 'any',
  q: '',
  sort: 'watched',
};

export const MAX_SEARCH_LENGTH = 80;

// Every field falls back to its default on any bad value, so untrusted
// parameters can never make parsing throw.
const schema = z.object({
  tab: z.enum(hubTabs).catch(defaultLiveQuery.tab),
  mode: z.enum(modes).catch(defaultLiveQuery.mode),
  q: z
    .string()
    .transform((value) => value.trim().slice(0, MAX_SEARCH_LENGTH).trim())
    .catch(defaultLiveQuery.q),
  sort: z.enum(sorts).catch(defaultLiveQuery.sort),
});

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

/** Reads the hub's URL state; bad or missing values become defaults. */
export const parseLiveQuery = (params: SearchParams): LiveQuery =>
  schema.parse({
    tab: first(params['tab']),
    mode: first(params['mode']),
    q: first(params['q']),
    sort: first(params['sort']),
  });

/** The hub URL for a query, carrying only the non-default values. */
export function hubHref(query: LiveQuery): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(defaultLiveQuery) as (keyof LiveQuery)[])
    if (query[key] !== defaultLiveQuery[key]) params.set(key, query[key]);
  const search = params.toString();
  return search === '' ? watchRoutes.hub : `${watchRoutes.hub}?${search}`;
}

const withoutFilters = (query: LiveQuery): LiveQuery => ({
  ...query,
  mode: defaultLiveQuery.mode,
  q: defaultLiveQuery.q,
});

export const clearFiltersHref = (query: LiveQuery): string =>
  hubHref(withoutFilters(query));

/** True when a filter (not the tab or sort) differs from its default. */
export const isFiltered = (query: LiveQuery): boolean =>
  hubHref(withoutFilters(query)) !== hubHref(query);
