import { createAppError } from '@daisy/errors';
import type { ObservationExecutionGuard } from './observation-contracts';
/** Resource work ownership is admission only; it cannot issue or renew recipient authority. */
export function requireCurrentObservation(guard: ObservationExecutionGuard) {
  if (guard.isCurrent && guard.isCurrent() !== true)
    throw createAppError('INFRASTRUCTURE', 'Observation work unavailable');
}
