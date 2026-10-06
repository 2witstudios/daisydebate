import { z } from 'zod';
import type { SearchParams } from '../access/decision';

const scopes = ['top', 'around'] as const;
const statuses = ['established', 'provisional', 'everyone'] as const;
const views = ['chart', 'table'] as const;

export type LadderScope = (typeof scopes)[number];
export type LadderStatus = (typeof statuses)[number];
export type HistoryView = (typeof views)[number];

export type LadderQuery = {
  /** Null is the current season. */
  readonly season: number | null;
  readonly scope: LadderScope;
  readonly q: string;
  readonly status: LadderStatus;
  readonly page: number;
  /** Username of the debater whose detail is open, if any. */
  readonly debater: string | null;
  readonly view: HistoryView;
  /** The debate the chart readout is stepped to; null is the latest. */
  readonly step: number | null;
};

export const defaultQuery: LadderQuery = {
  season: null,
  scope: 'top',
  q: '',
  status: 'established',
  page: 1,
  debater: null,
  view: 'chart',
  step: null,
};

/** Longest search and username the ladder reads. */
export const MAX_SEARCH_LENGTH = 40;

const count = z
  .string()
  .regex(/^\d{1,6}$/)
  .transform(Number);

// Every field falls back to its default on any bad value, so untrusted
// parameters can never make parsing throw.
const querySchema = z.object({
  season: count.nullable().catch(defaultQuery.season),
  scope: z.enum(scopes).catch(defaultQuery.scope),
  q: z
    .string()
    .transform((value) => value.trim().slice(0, MAX_SEARCH_LENGTH).trim())
    .catch(defaultQuery.q),
  status: z.enum(statuses).catch(defaultQuery.status),
  page: count.transform((page) => Math.max(1, page)).catch(defaultQuery.page),
  debater: z
    .string()
    .regex(/^[a-z0-9-]{1,40}$/)
    .nullable()
    .catch(defaultQuery.debater),
  view: z.enum(views).catch(defaultQuery.view),
  step: count.nullable().catch(defaultQuery.step),
});

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

const keys = Object.keys(defaultQuery) as (keyof LadderQuery)[];

/** Reads the ladder's URL state; bad or missing values become defaults. */
export function parseLadderQuery(params: SearchParams): LadderQuery {
  return querySchema.parse(
    Object.fromEntries(
      keys.map((key) => [key, first(params[key]) ?? undefined]),
    ),
  ) as LadderQuery;
}

const PATH = '/leaderboard';

/** The ladder URL for a query, carrying only the non-default values. */
export function ladderHref(query: LadderQuery): string {
  const params = new URLSearchParams();
  for (const key of keys) {
    if (query[key] !== defaultQuery[key]) params.set(key, String(query[key]));
  }
  const search = params.toString();
  return search === '' ? PATH : `${PATH}?${search}`;
}

/** Filters go back to their defaults; the season and scope stay. */
const withoutFilters = (query: LadderQuery): LadderQuery => ({
  ...query,
  q: defaultQuery.q,
  status: defaultQuery.status,
  page: defaultQuery.page,
});

export const clearFiltersHref = (query: LadderQuery): string =>
  ladderHref(withoutFilters(query));

/** True when a search or a status filter is set. */
export const isFiltered = (query: LadderQuery): boolean =>
  query.q !== defaultQuery.q || query.status !== defaultQuery.status;

/** The filters living in the phone panel; search has its own field. */
export const activeFilterCount = (query: LadderQuery): number =>
  query.status !== defaultQuery.status ? 1 : 0;

/** A link to the same ladder with another debater's detail open. */
export const debaterHref = (query: LadderQuery, username: string): string =>
  ladderHref({ ...query, debater: username, view: 'chart', step: null });

/** The ladder with the detail closed. */
export const closeDetailHref = (query: LadderQuery): string =>
  ladderHref({
    ...query,
    debater: defaultQuery.debater,
    view: defaultQuery.view,
    step: defaultQuery.step,
  });

/** The same ladder on another page. */
export const pageHref = (query: LadderQuery, page: number): string =>
  ladderHref({ ...query, page, debater: null, view: 'chart', step: null });

/** The top of the ladder or the window around the viewer. */
export const scopeHref = (query: LadderQuery, scope: LadderScope): string =>
  ladderHref({ ...query, scope, page: 1 });

/** The same search across established and provisional debaters. */
export const everyoneHref = (query: LadderQuery): string =>
  ladderHref({ ...query, status: 'everyone', page: 1 });

/** The ladder of another season with no filters. */
export const seasonHref = (season: number): string =>
  ladderHref({ ...defaultQuery, season });

/** The chart or the table alternative, at the latest debate. */
export const viewHref = (query: LadderQuery, view: HistoryView): string =>
  ladderHref({ ...query, view, step: null });
