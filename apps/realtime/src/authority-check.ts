import { capacityRefusalDetail } from '@daisy/db/capacity';
import { createAppError } from '@daisy/errors';
import type { IntervalTimers } from './outbox-drain';

const BUDGET_SPENT = Symbol('authority check budget spent');
/**
 * Which part of an authority check gave out, as loggable fields with no raw
 * error: a lane's refusal with its pressure, the budget, or the read itself.
 */
export function authorityFailureFields(error: unknown) {
  const refusal = capacityRefusalDetail(error);
  if (refusal)
    return { cause: `${refusal.lane}.${refusal.reason}`, ...refusal.pressure };
  return { cause: isBudgetSpent(error) ? 'budget' : 'read' };
}
const isBudgetSpent = (error: unknown) =>
  error instanceof Error && error.cause === BUDGET_SPENT;

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
            createAppError(
              'INFRASTRUCTURE',
              'Authority check budget spent',
              BUDGET_SPENT,
            ),
          ),
        budgetMs,
      );
      Promise.resolve().then(check).then(resolve, reject);
    });
  } finally {
    if (handle !== undefined) timers.clearInterval(handle);
  }
}
