import { createAppError } from '@daisy/errors';
import type { IntervalTimers } from './outbox-drain';

/** Resource budget only: canonical authority/deadlines remain the sole grant.
 * A read that fails or outlasts the budget rejects, so callers can tell a
 * transient failure from a denial; a late read cannot replace that rejection.
 */
export async function boundedAuthorityCheck<T>({
  check,
  timers,
  budgetMs,
}: {
  readonly check: () => Promise<T>;
  readonly timers: IntervalTimers;
  readonly budgetMs: number;
}): Promise<T> {
  let handle: ReturnType<typeof setInterval> | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      handle = timers.setInterval(
        () =>
          reject(
            createAppError('INFRASTRUCTURE', 'Authority check budget spent'),
          ),
        budgetMs,
      );
      Promise.resolve().then(check).then(resolve, reject);
    });
  } finally {
    if (handle !== undefined) timers.clearInterval(handle);
  }
}
