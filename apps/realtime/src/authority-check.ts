import type { IntervalTimers } from './outbox-drain';

/** Resource budget only: canonical authority/deadlines remain the sole grant.
 * A late read may finish, but it cannot replace the already returned refusal.
 */
export async function boundedAuthorityCheck<T>({
  check,
  denied,
  timers,
  budgetMs,
}: {
  readonly check: () => Promise<T>;
  readonly denied: T;
  readonly timers: IntervalTimers;
  readonly budgetMs: number;
}): Promise<T> {
  let handle: ReturnType<typeof setInterval> | undefined;
  try {
    return await new Promise<T>((resolve) => {
      handle = timers.setInterval(() => resolve(denied), budgetMs);
      Promise.resolve()
        .then(check)
        .then(resolve, () => resolve(denied));
    });
  } finally {
    if (handle !== undefined) timers.clearInterval(handle);
  }
}
