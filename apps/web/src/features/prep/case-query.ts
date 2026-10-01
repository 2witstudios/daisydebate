import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import { MAX_FIELD_LENGTH } from './library-query';

export const views = ['compose', 'compare', 'export'] as const;
const formats = ['speech', 'flow', 'cards'] as const;
const optionIds = ['cite', 'break', 'large', 'notes', 'cred'] as const;

export type CaseViewTab = (typeof views)[number];
export type ExportFormat = (typeof formats)[number];
export type ExportOption = (typeof optionIds)[number];

export type CaseQuery = {
  readonly view: CaseViewTab;
  readonly speech: string;
  /** A saved version number as text, or "draft". */
  readonly from: string;
  readonly to: string;
  readonly fmt: ExportFormat;
  /** True once the export options form has been submitted. */
  readonly optionsSet: boolean;
  readonly opts: readonly ExportOption[];
  readonly q: string;
};

const defaultOptions: readonly ExportOption[] = ['cite', 'break', 'large'];

const token = z
  .string()
  .regex(/^[a-z0-9]{1,8}$/)
  .catch('');

const schema = z.object({
  view: z.enum(views).catch('compose'),
  speech: token,
  from: token,
  to: token,
  fmt: z.enum(formats).catch('speech'),
  set: z.string().catch(''),
  opt: z.array(z.enum(optionIds).catch('cite')).catch([]),
  q: z
    .string()
    .transform((v) => v.trim().slice(0, MAX_FIELD_LENGTH))
    .catch(''),
});

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];
const all = (
  value: string | readonly string[] | undefined,
): readonly string[] => (typeof value === 'string' ? [value] : (value ?? []));

export function parseCaseQuery(params: SearchParams): CaseQuery {
  const parsed = schema.parse({
    view: first(params['view']),
    speech: first(params['speech']) ?? '',
    from: first(params['from']) ?? '',
    to: first(params['to']) ?? '',
    fmt: first(params['fmt']),
    set: first(params['set']) ?? '',
    opt: all(params['opt']).filter((id) =>
      (optionIds as readonly string[]).includes(id),
    ),
    q: first(params['q']) ?? '',
  });
  const optionsSet = parsed.set !== '';
  return {
    view: parsed.view,
    speech: parsed.speech,
    from: parsed.from,
    to: parsed.to,
    fmt: parsed.fmt,
    optionsSet,
    opts: optionsSet ? [...new Set(parsed.opt)] : defaultOptions,
    q: parsed.q,
  };
}

const unlessDefault = (value: string | undefined, fallback: string): string =>
  value === undefined || value === fallback ? '' : value;

/** The non-default pairs a query puts in the URL, in a fixed order. */
function queryPairs(query: Partial<CaseQuery>): [string, string][] {
  const pairs: [string, string][] = [
    ['view', unlessDefault(query.view, 'compose')],
    ['speech', query.speech ?? ''],
    ['from', query.from ?? ''],
    ['to', query.to ?? ''],
    ['fmt', unlessDefault(query.fmt, 'speech')],
  ];
  if (query.optionsSet === true)
    pairs.push(
      ['set', '1'],
      ...(query.opts ?? []).map((opt): [string, string] => ['opt', opt]),
    );
  pairs.push(['q', query.q ?? '']);
  return pairs.filter(([, value]) => value !== '');
}

export function caseHref(id: string, query: Partial<CaseQuery>): string {
  const text = new URLSearchParams(queryPairs(query)).toString();
  return text === '' ? `/prep/cases/${id}` : `/prep/cases/${id}?${text}`;
}
