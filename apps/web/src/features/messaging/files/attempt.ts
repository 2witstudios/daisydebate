import { createAppError } from '@daisy/errors';
/** Deadline starts before async work; a late successful callback grants no renewal. */
export function requireFileAttempt(
  startedAt: string,
  now: string,
  serviceMs: number,
): void {
  const start = Date.parse(startedAt),
    current = Date.parse(now);
  if (
    !Number.isSafeInteger(serviceMs) ||
    serviceMs < 1 ||
    !Number.isFinite(start) ||
    !Number.isFinite(current) ||
    current < start ||
    current >= start + serviceMs
  )
    throw createAppError('CONFLICT');
}
