import { createAppError } from '@daisy/errors';

/** Cancellation is control authority loss, never a successful provider response. */
export function requireProviderNotCancelled(signal?: AbortSignal) {
  if (signal?.aborted)
    throw createAppError('CONFLICT', 'Provider operation cancelled');
}
