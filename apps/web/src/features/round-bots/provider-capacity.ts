import { createAppError } from '@daisy/errors';
/** Process-local configured capacity shared by speech, TTS and judging; no unbounded wait queue. */
export function createProviderCapacity(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw createAppError('VALIDATION');
  let active = 0;
  return async function withProvider<T>(
    signal: AbortSignal,
    work: () => Promise<T>,
  ): Promise<T> {
    if (signal.aborted || active >= limit)
      throw createAppError('CONFLICT', 'Provider capacity unavailable');
    active += 1;
    try {
      return await work();
    } finally {
      active -= 1;
    }
  };
}
