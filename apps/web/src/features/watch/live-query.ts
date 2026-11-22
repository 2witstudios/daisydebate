import { idSchema } from '@daisy/protocol/primitives';
import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import { watchRoutes } from './routes';

/** The hub's public tabs: Recordings is its own guarded route. */
const hubTabs = ['live', 'following'] as const;
const modes = ['any', 'ranked', 'casual'] as const;

type HubTab = (typeof hubTabs)[number];
type LiveMode = (typeof modes)[number];

export type LiveQuery = {
  readonly tab: HubTab;
  readonly mode: LiveMode;
  readonly q: string;
  /** The selected standing lobby id, or empty to use the landing lobby. */
  readonly lobby: string;
  /** The Round id this page starts after; empty on the first page. */
  readonly before: string;
};

export const defaultLiveQuery: LiveQuery = {
  tab: 'live',
  mode: 'any',
  q: '',
  lobby: '',
  before: '',
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
  lobby: idSchema.catch(defaultLiveQuery.lobby),
  before: idSchema.catch(defaultLiveQuery.before),
});

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

/** Reads the hub's URL state; bad or missing values become defaults. */
export const parseLiveQuery = (params: SearchParams): LiveQuery =>
  schema.parse({
    tab: first(params['tab']),
    mode: first(params['mode']),
    q: first(params['q']),
    lobby: first(params['lobby']),
    before: first(params['before']),
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
  before: defaultLiveQuery.before,
});

export const clearFiltersHref = (query: LiveQuery): string =>
  hubHref(withoutFilters(query));

/** True when a filter (not the tab) differs from its default. */
export const isFiltered = (query: LiveQuery): boolean =>
  hubHref(withoutFilters(query)) !== hubHref(query);
