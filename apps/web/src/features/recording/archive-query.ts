import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import { MAX_SEARCH_LENGTH } from './live-query';
import { watchRoutes } from './routes';

const scopes = ['all', 'mine'] as const;
const modes = ['any', 'ranked', 'casual'] as const;
const sorts = ['newest', 'longest', 'rated'] as const;

/** `all` is the public archive; `mine` adds the viewer's unlisted and private. */
type RecordingScope = (typeof scopes)[number];

export type RecordingsQuery = {
  readonly scope: RecordingScope;
  readonly mode: (typeof modes)[number];
  readonly q: string;
  readonly sort: (typeof sorts)[number];
};

export const defaultRecordingsQuery: RecordingsQuery = {
  scope: 'all',
  mode: 'any',
  q: '',
  sort: 'newest',
};

// Every field falls back to its default on any bad value.
const schema = z.object({
  scope: z.enum(scopes).catch(defaultRecordingsQuery.scope),
  mode: z.enum(modes).catch(defaultRecordingsQuery.mode),
  q: z
    .string()
    .transform((value) => value.trim().slice(0, MAX_SEARCH_LENGTH).trim())
    .catch(defaultRecordingsQuery.q),
  sort: z.enum(sorts).catch(defaultRecordingsQuery.sort),
});

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

/** Reads the archive's URL state; bad or missing values become defaults. */
export const parseRecordingsQuery = (params: SearchParams): RecordingsQuery =>
  schema.parse({
    scope: first(params['scope']),
    mode: first(params['mode']),
    q: first(params['q']),
    sort: first(params['sort']),
  });

/** The archive URL for a query, carrying only the non-default values. */
export function recordingsHref(query: RecordingsQuery): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(
    defaultRecordingsQuery,
  ) as (keyof RecordingsQuery)[])
    if (query[key] !== defaultRecordingsQuery[key]) params.set(key, query[key]);
  const search = params.toString();
  return search === ''
    ? watchRoutes.recordings
    : `${watchRoutes.recordings}?${search}`;
}

const withoutFilters = (query: RecordingsQuery): RecordingsQuery => ({
  ...query,
  mode: defaultRecordingsQuery.mode,
  q: defaultRecordingsQuery.q,
});

/** Filters reset; the scope and sort stay. */
export const clearRecordingFiltersHref = (query: RecordingsQuery): string =>
  recordingsHref(withoutFilters(query));

export const isRecordingsFiltered = (query: RecordingsQuery): boolean =>
  recordingsHref(withoutFilters(query)) !== recordingsHref(query);
