import { createAppError } from '@daisy/errors';

/** A provider call run inside a budget: refused with CONFLICT when the budget is full. */
export type ProviderCall = <T>(
  signal: AbortSignal,
  work: () => Promise<T>,
) => Promise<T>;

/**
 * A process-local bounded count of concurrent provider calls; no waiting
 * queue and no early release on cancellation. It knows nothing of what the
 * calls are for: each budget is its own instance, so separate work never
 * shares a counter (ISSUE-748).
 */
export function createProviderBudget(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw createAppError('VALIDATION');
  let active = 0;
  /** Takes a slot now, or null when the budget is full; the release is idempotent. */
  const reserve = () => {
    if (active >= limit) return null;
    active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active -= 1;
    };
  };
  const withProvider: ProviderCall = async (signal, work) => {
    const release = signal.aborted ? null : reserve();
    if (!release)
      throw createAppError('CONFLICT', 'Provider capacity unavailable');
    try {
      return await work();
    } finally {
      release();
    }
  };
  return Object.assign(withProvider, { reserve });
}
