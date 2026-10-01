import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import { rankedDestinations } from './actions';
import type { RankedRating } from './standing';

/** "Within N of my rating"; 0 is any rating. */
export const hostBands = [100, 200, 300, 0] as const;
export type HostBand = (typeof hostBands)[number];

type HostStep = 'edit' | 'posted';

export type HostQuery = {
  readonly step: HostStep;
  readonly band: HostBand;
};

export const defaultHostQuery: HostQuery = { step: 'edit', band: 200 };

// Every field falls back to its default on any bad value.
const querySchema = z.object({
  step: z.enum(['edit', 'posted']).catch(defaultHostQuery.step),
  band: z
    .enum(hostBands.map(String) as [string, ...string[]])
    .transform((value) => Number(value) as HostBand)
    .catch(defaultHostQuery.band),
});

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

export function parseHostQuery(params: SearchParams): HostQuery {
  return querySchema.parse({
    step: first(params['step']),
    band: first(params['band']),
  });
}

/** The host URL for a query, carrying only the non-default values. */
export function hostHref({ step, band }: HostQuery): string {
  const params = new URLSearchParams();
  if (step !== defaultHostQuery.step) params.set('step', step);
  if (band !== defaultHostQuery.band) params.set('band', String(band));
  const search = params.toString();
  return search === ''
    ? rankedDestinations.hostTable
    : `${rankedDestinations.hostTable}?${search}`;
}

/** Accepted ratings for the open seat; `null` means anyone can take it. */
export type SeatSpan = { readonly min: number; readonly max: number } | null;

/** The span around the host's rating, or null for any band or no rating. */
export function seatSpan(rating: RankedRating, band: HostBand): SeatSpan {
  if (rating.kind === 'unrated' || band === 0) return null;
  return { min: rating.value - band, max: rating.value + band };
}

export const seatSpanText = (span: SeatSpan): string =>
  span === null
    ? 'Any rating can take the seat'
    : `Ratings ${span.min} to ${span.max} can take the seat`;

export const bandLabel = (band: HostBand): string =>
  band === 0 ? 'Any rating' : `Within ${band} of my rating`;
