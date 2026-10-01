import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import {
  ruleKinds,
  structures,
  tournamentTabs,
  type RulesKind,
  type Structure,
  type TournamentTab,
} from './tournament';

export type TournamentsQuery = {
  readonly tab: TournamentTab;
  readonly q: string;
  readonly structure: 'all' | Structure;
  readonly rules: 'all' | RulesKind;
};

export const defaultQuery: TournamentsQuery = {
  tab: 'open',
  q: '',
  structure: 'all',
  rules: 'all',
};

/** Longest search the index reads; the form's maxlength matches. */
export const MAX_SEARCH_LENGTH = 80;

// Every field falls back to its default on any bad value, so untrusted
// parameters can never make parsing throw.
const schema = z.object({
  tab: z.enum(tournamentTabs).catch(defaultQuery.tab),
  q: z
    .string()
    .transform((value) => value.trim().slice(0, MAX_SEARCH_LENGTH).trim())
    .catch(defaultQuery.q),
  structure: z.enum(['all', ...structures]).catch(defaultQuery.structure),
  rules: z.enum(['all', ...ruleKinds]).catch(defaultQuery.rules),
});

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

/** Reads the index's URL state; bad or missing values become defaults. */
export const parseTournamentsQuery = (params: SearchParams): TournamentsQuery =>
  schema.parse({
    tab: first(params['tab']),
    q: first(params['q']),
    structure: first(params['structure']),
    rules: first(params['rules']),
  });

/** The index URL for a query, carrying only the non-default values. */
export function tournamentsHref(query: TournamentsQuery): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(defaultQuery) as (keyof TournamentsQuery)[]) {
    if (query[key] !== defaultQuery[key]) params.set(key, query[key]);
  }
  const search = params.toString();
  return search === '' ? '/tournaments' : `/tournaments?${search}`;
}

/** Filters reset to their defaults; the tab stays. */
const withoutFilters = (query: TournamentsQuery): TournamentsQuery => ({
  ...query,
  q: defaultQuery.q,
  structure: defaultQuery.structure,
  rules: defaultQuery.rules,
});

export const clearFiltersHref = (query: TournamentsQuery): string =>
  tournamentsHref(withoutFilters(query));

/** True when any filter (not the tab) differs from its default. */
export const isFiltered = (query: TournamentsQuery): boolean =>
  tournamentsHref(withoutFilters(query)) !== tournamentsHref(query);

/** Filters living in the phone panel: search has its own field. */
export const activeFilterCount = (query: TournamentsQuery): number =>
  [
    query.structure !== defaultQuery.structure,
    query.rules !== defaultQuery.rules,
  ].filter(Boolean).length;
