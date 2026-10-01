import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import { tournamentRoutes } from './routes';

export const detailTabs = ['overview', 'entrants', 'bracket', 'rules'] as const;
export type DetailTab = (typeof detailTabs)[number];

export type DetailQuery = {
  readonly tab: DetailTab;
  /** Entrants tab: list every entrant instead of the first page. */
  readonly all: boolean;
};

export const defaultDetailQuery: DetailQuery = { tab: 'overview', all: false };

const schema = z.object({
  tab: z.enum(detailTabs).catch(defaultDetailQuery.tab),
  all: z
    .string()
    .transform((value) => value === '1')
    .catch(defaultDetailQuery.all),
});

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

/** Reads the detail page's URL state; bad values become defaults. */
export const parseDetailQuery = (params: SearchParams): DetailQuery =>
  schema.parse({ tab: first(params['tab']), all: first(params['all']) });

/** The detail URL for a tab, carrying only the non-default values. */
export function detailHref(id: string, query: DetailQuery): string {
  const params = new URLSearchParams();
  if (query.tab !== defaultDetailQuery.tab) params.set('tab', query.tab);
  if (query.all) params.set('all', '1');
  const search = params.toString();
  const base = tournamentRoutes.detail(id);
  return search === '' ? base : `${base}?${search}`;
}
