import { createAppError } from '@daisy/errors';

/** Worker leases are whole milliseconds from 1ms to one minute. */
export function requireLeaseMs(leaseMs: number): void {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 60000)
    throw createAppError('VALIDATION');
}

/** Fencing epochs are PostgreSQL integers; exhaustion refuses rather than wraps. */
export function nextEpoch(current: number, exhausted: string): number {
  const epoch = current + 1;
  if (epoch > 2147483647) throw createAppError('CONFLICT', exhausted);
  return epoch;
}
