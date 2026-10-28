import { inflateDeviation, isProvisional } from '@daisy/debate-engine';
import type { RatingState } from '@daisy/protocol';

/** Shared display policy: classify full precision at the one injected read instant. */
export function ratingStanding(
  state: RatingState,
  lastRatedAt: string | null,
  now: string,
) {
  const widened = inflateDeviation(state, lastRatedAt, now);
  return {
    rating: Math.round(widened.rating),
    deviation: widened.deviation,
    provisional: isProvisional(widened.deviation),
  };
}
