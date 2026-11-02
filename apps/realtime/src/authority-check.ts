import { capacityRefusalDetail, databaseFailure } from '@daisy/db/capacity';
import { createAppError } from '@daisy/errors';
import type { IntervalTimers } from './outbox-drain';

const BUDGET_SPENT = Symbol('authority check budget spent');
/**
 * Which part of an authority check gave out, as loggable fields with no raw
 * error: a lane's refusal with its pressure, the budget, what the database
 * said, or `internal` for a failure that never reached it.
 */
export function authorityFailureFields(error: unknown) {
  const refusal = capacityRefusalDetail(error);
  if (refusal)
    return { cause: `${refusal.lane}.${refusal.reason}`, ...refusal.pressure };
  if (isBudgetSpent(error)) return { cause: 'budget' };
  return { cause: databaseFailure(error) ?? 'internal' };
}
const isBudgetSpent = (error: unknown) =>
  error instanceof Error && error.cause === BUDGET_SPENT;

/** Resource budget only: canonical authority/deadlines remain the sole grant.
 * A read that fails or outlasts the budget rejects, so callers can tell a
 * transient failure from a denial; a late read cannot replace that rejection,
 * and the signal stops a chain of reads before it takes the lane again.
 */
export async function boundedAuthorityCheck<T>({
  check,
  timers,
  budgetMs,
}: {
  readonly check: (signal: AbortSignal) => Promise<T>;
  readonly timers: IntervalTimers;
  readonly budgetMs: number;
}): Promise<T> {
  let handle: ReturnType<typeof setInterval> | undefined;
  const budget = new AbortController();
  try {
    return await new Promise<T>((resolve, reject) => {
      handle = timers.setInterval(() => {
        const spent = createAppError(
          'INFRASTRUCTURE',
          'Authority check budget spent',
          BUDGET_SPENT,
        );
        budget.abort(spent);
        reject(spent);
      }, budgetMs);
      Promise.resolve()
        .then(() => check(budget.signal))
        .then(resolve, reject);
    });
  } finally {
    if (handle !== undefined) timers.clearInterval(handle);
  }
}
