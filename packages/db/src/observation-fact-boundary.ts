import { createAppError } from '@daisy/errors';
import { observationResourceKey } from '@daisy/protocol';
import type { ObservationBinding } from './observation-contracts';
export const observationFactKey = (binding: ObservationBinding) =>
  `${observationResourceKey(binding.resource)}:${binding.principal.actorId}`;
/** Technical work admission refuses overflow, never a truncated cast or a new product group limit. */
export function assertObservationFactBudget(size: number) {
  if (size > 4096)
    throw createAppError(
      'INFRASTRUCTURE',
      'Authority fact capacity unavailable',
    );
}
/** A fence set in canonical order: accounts by actor id, then contact pairs by (low, high). */
export function sortedDependencies(
  actors: ReadonlySet<string>,
  pairs: ReadonlyMap<string, { readonly low: string; readonly high: string }>,
) {
  return {
    actors: [...actors].sort(),
    pairs: [...pairs.values()].sort(
      (a, b) => a.low.localeCompare(b.low) || a.high.localeCompare(b.high),
    ),
  };
}
