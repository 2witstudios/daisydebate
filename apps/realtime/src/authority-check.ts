import { capacityRefusalDetail } from '@daisy/db/capacity';
import { createAppError, isAppError } from '@daisy/errors';
import type { IntervalTimers } from './outbox-drain';

const BUDGET_SPENT = 'Authority check budget spent';
/**
 * Which part of an authority check gave out, safe to log: a lane's refusal
 * (`admission.expired`), the budget, or the read itself. It carries no raw error.
 */
export function authorityFailureCause(error: unknown) {
  const refusal = capacityRefusalDetail(error);
  if (refusal) return `${refusal.lane}.${refusal.reason}`;
  return isAppError(error) && error.message === BUDGET_SPENT
    ? 'budget'
    : 'read';
}

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
        () => reject(createAppError('INFRASTRUCTURE', BUDGET_SPENT)),
        budgetMs,
      );
      Promise.resolve().then(check).then(resolve, reject);
    });
  } finally {
    if (handle !== undefined) timers.clearInterval(handle);
  }
}
