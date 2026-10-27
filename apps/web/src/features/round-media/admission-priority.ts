import type { Logger } from '@daisy/logger';
import type { createRedis } from '@daisy/redis';

/** Hint failures reduce fairness only; PostgreSQL still rechecks every admission. */
export function createAdmissionPriority(input: {
  readonly hint: ReturnType<typeof createRedis>['mediaAdmissionHint'];
  readonly logger: Logger;
}) {
  let degraded = false;
  return async (
    sessionId: string,
    operation: 'enter' | 'leave' | 'waiting',
    waiterId?: string,
  ) => {
    try {
      const waiting = await input.hint(sessionId, operation, waiterId);
      degraded = false;
      return waiting;
    } catch {
      if (!degraded)
        input.logger.log(
          'round.media.fairness_degraded',
          { operation },
          'Media admission fairness unavailable',
        );
      degraded = true;
      return false;
    }
  };
}
