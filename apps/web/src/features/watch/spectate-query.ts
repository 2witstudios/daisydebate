import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import { liveHref } from './routes';

/** The live column shows one pane at a time: the transcript or the chat. */
const panes = ['transcript', 'chat'] as const;
export type SpectatePane = (typeof panes)[number];

export type SpectateQuery = {
  readonly pane: SpectatePane;
};

export const defaultSpectateQuery: SpectateQuery = {
  pane: 'transcript',
};

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

/** Reads the live view's URL state; bad values become the defaults. */
export function parseSpectateQuery(params: SearchParams): SpectateQuery {
  const pane = z.enum(panes).catch(defaultSpectateQuery.pane);
  return { pane: pane.parse(first(params['pane'])) };
}

/** The live view URL for a Round and query, with only non-default values. */
export function spectateHref(id: string, query: SpectateQuery): string {
  return liveHref(
    id,
    query.pane === defaultSpectateQuery.pane ? '' : `pane=${query.pane}`,
  );
}
