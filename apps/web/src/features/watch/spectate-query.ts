import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import { liveHref } from './routes';

/** The phone shows one pane at a time; desktop shows them together. */
const panes = ['speeches', 'chat', 'about'] as const;
export type SpectatePane = (typeof panes)[number];

/** What the open report dialog is about: the debate or one chat message. */
type ReportSubject =
  | { readonly kind: 'debate' }
  | { readonly kind: 'message'; readonly id: string };

export type SpectateQuery = {
  readonly pane: SpectatePane;
  readonly report: ReportSubject | null;
};

export const defaultSpectateQuery: SpectateQuery = {
  pane: 'speeches',
  report: null,
};

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

const MESSAGE_PREFIX = 'message:';

const subjectSchema = z
  .string()
  .transform((value): ReportSubject | null => {
    if (value === 'debate') return { kind: 'debate' };
    const id = value.startsWith(MESSAGE_PREFIX)
      ? value.slice(MESSAGE_PREFIX.length)
      : '';
    return /^[a-z0-9-]{1,40}$/.test(id) ? { kind: 'message', id } : null;
  })
  .catch(null);

/** Reads the live view's URL state; bad values become the defaults. */
export function parseSpectateQuery(params: SearchParams): SpectateQuery {
  const pane = z.enum(panes).catch(defaultSpectateQuery.pane);
  const report = first(params['report']);
  return {
    pane: pane.parse(first(params['pane'])),
    report: report === undefined ? null : subjectSchema.parse(report),
  };
}

const subjectParam = (subject: ReportSubject): string =>
  subject.kind === 'debate' ? 'debate' : `${MESSAGE_PREFIX}${subject.id}`;

/** The live view URL for a debate and query, with only non-default values. */
export function spectateHref(id: string, query: SpectateQuery): string {
  const params = new URLSearchParams();
  if (query.pane !== defaultSpectateQuery.pane) params.set('pane', query.pane);
  if (query.report !== null) params.set('report', subjectParam(query.report));
  return liveHref(id, params.toString());
}
