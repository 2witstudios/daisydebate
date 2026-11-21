import { tryInstantMs } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
/** Deadline starts before async work; a late successful callback grants no renewal. */
export function requireFileAttempt(
  startedAt: string,
  now: string,
  serviceMs: number,
): void {
  const start = tryInstantMs(startedAt),
    current = tryInstantMs(now);
  if (
    !Number.isSafeInteger(serviceMs) ||
    serviceMs < 1 ||
    start === undefined ||
    current === undefined ||
    current < start ||
    current >= start + serviceMs
  )
    throw createAppError('CONFLICT');
}
