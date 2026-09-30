import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import type { Visibility } from './debate';
import { MAX_SEARCH_LENGTH } from './live-query';
import { replayHref } from './routes';

const speeds = ['1', '1.5', '2'] as const;
/** The phone shows one pane at a time; desktop shows them together. */
const panes = ['transcript', 'result', 'share'] as const;
const visibilities = ['public', 'unlisted', 'private'] as const;

export type ReplaySpeed = (typeof speeds)[number];
export type ReplayPane = (typeof panes)[number];

export type ReplayQuery = {
  /** Playback position in whole seconds; clamped to the timetable later. */
  readonly t: number;
  readonly q: string;
  readonly speed: ReplaySpeed;
  readonly pane: ReplayPane;
  /** Whether the visibility manager is open. */
  readonly manage: boolean;
  /** The visibility chosen in the manager, before any save. */
  readonly vis: Visibility | null;
};

export const defaultReplayQuery: ReplayQuery = {
  t: 690,
  q: '',
  speed: '1',
  pane: 'transcript',
  manage: false,
  vis: null,
};

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

// Every field falls back to its default on any bad value.
const schema = z.object({
  t: z
    .string()
    .regex(/^\d{1,5}$/)
    .transform(Number)
    .catch(defaultReplayQuery.t),
  q: z
    .string()
    .transform((value) => value.trim().slice(0, MAX_SEARCH_LENGTH).trim())
    .catch(defaultReplayQuery.q),
  speed: z.enum(speeds).catch(defaultReplayQuery.speed),
  pane: z.enum(panes).catch(defaultReplayQuery.pane),
  manage: z
    .enum(['1'])
    .transform(() => true)
    .catch(defaultReplayQuery.manage),
  vis: z.enum(visibilities).nullable().catch(defaultReplayQuery.vis),
});

/** Reads the replay's URL state; bad or missing values become defaults. */
export const parseReplayQuery = (params: SearchParams): ReplayQuery =>
  schema.parse({
    t: first(params['t']),
    q: first(params['q']),
    speed: first(params['speed']),
    pane: first(params['pane']),
    manage: first(params['manage']),
    vis: first(params['vis']) ?? null,
  });

const encoders: {
  readonly [K in keyof ReplayQuery]: (value: ReplayQuery[K]) => string | null;
} = {
  t: String,
  q: (value) => value,
  speed: (value) => value,
  pane: (value) => value,
  manage: (value) => (value ? '1' : null),
  vis: (value) => value,
};

/** The replay URL for a debate and query, with only non-default values. */
export function replayQueryHref(id: string, query: ReplayQuery): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(defaultReplayQuery) as (keyof ReplayQuery)[]) {
    if (query[key] === defaultReplayQuery[key]) continue;
    const encode = encoders[key] as (value: unknown) => string | null;
    const value = encode(query[key]);
    if (value !== null) params.set(key, value);
  }
  return replayHref(id, params.toString());
}

/**
 * The query as hidden form fields, minus the ones the form edits itself, so a
 * GET form inside the replay keeps the rest of the state.
 */
export function replayHiddenFields(
  query: ReplayQuery,
  omit: readonly (keyof ReplayQuery)[],
): readonly (readonly [string, string])[] {
  const params = new URLSearchParams(
    replayQueryHref('x', query).split('?')[1] ?? '',
  );
  return [...params.entries()].filter(
    ([name]) => !omit.includes(name as keyof ReplayQuery),
  );
}
