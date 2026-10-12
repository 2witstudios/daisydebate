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
