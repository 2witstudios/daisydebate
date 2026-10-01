import { z } from 'zod';
import type { SearchParams } from '../access/decision';

/** The matchmaking steps after the hub, in the order the mock plays them. */
export const matchSteps = [
  'search',
  'offer',
  'waiting',
  'ready',
  'entering',
  'ended',
] as const;

export type MatchStep = (typeof matchSteps)[number];
export type RankedStep = 'hub' | MatchStep;

/** The Ranked page's whole state: which step, and whether the rules show. */
export type RankedQuery = {
  readonly step: RankedStep;
  readonly rules: boolean;
};

export const defaultRankedQuery: RankedQuery = { step: 'hub', rules: false };

// A bad value falls back to its default, so untrusted parameters never throw.
const querySchema = z.object({
  step: z.enum(['hub', ...matchSteps]).catch(defaultRankedQuery.step),
  rules: z
    .enum(['1'])
    .transform(() => true)
    .catch(defaultRankedQuery.rules),
});

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

/** Reads the Ranked URL state. The rules drawer belongs to the hub alone. */
export function parseRankedQuery(params: SearchParams): RankedQuery {
  const { step, rules } = querySchema.parse({
    step: first(params['step']),
    rules: first(params['rules']),
  });
  return { step, rules: step === 'hub' && rules };
}

/** The Ranked URL for a query, carrying only the non-default values. */
export function rankedHref({ step, rules }: RankedQuery): string {
  const params = new URLSearchParams();
  if (step !== defaultRankedQuery.step) params.set('step', step);
  else if (rules) params.set('rules', '1');
  const search = params.toString();
  return search === '' ? '/ranked' : `/ranked?${search}`;
}

/** The URL of one matchmaking step. */
export const stepHref = (step: RankedStep): string =>
  rankedHref({ step, rules: false });
