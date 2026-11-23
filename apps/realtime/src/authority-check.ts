import { capacityRefusalFields } from '@daisy/db/capacity';
import { databaseFailure } from '@daisy/db/database-failure';
import { createAppError } from '@daisy/errors';
import type { Waits } from '@daisy/clock';

const BUDGET_SPENT = Symbol('authority check budget spent');
/**
 * Which part of an authority check gave out, as loggable fields with no raw
 * error: a lane's refusal with its pressure, the budget, what the database
 * said, or `internal` for anything else (a code bug, or Redis during a hello).
 */
export function authorityFailureFields(error: unknown) {
  const refusal = capacityRefusalFields(error);
  if (refusal) return refusal;
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
  waits,
  budgetMs,
}: {
  readonly check: (signal: AbortSignal) => Promise<T>;
  readonly waits: Waits;
  readonly budgetMs: number;
}): Promise<T> {
  const budget = new AbortController();
  /** Aborted once the check settles, so no budget wait outlives it. */
  const settled = new AbortController();
  try {
    return await new Promise<T>((resolve, reject) => {
      void waits.sleep(budgetMs, settled.signal).then(() => {
        if (settled.signal.aborted) return;
        const spent = createAppError(
          'INFRASTRUCTURE',
          'Authority check budget spent',
          BUDGET_SPENT,
        );
        budget.abort(spent);
        reject(spent);
      });
      Promise.resolve()
        .then(() => check(budget.signal))
        .then(resolve, reject);
    });
  } finally {
    settled.abort();
  }
}
