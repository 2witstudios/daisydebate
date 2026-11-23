import type { SQL } from 'bun';
import { deadlineSignal, type Waits } from '@daisy/clock';
import { drizzle } from 'drizzle-orm/bun-sql/postgres';
import { createAppError, isAppError } from '@daisy/errors';
import { RUNTIME_SESSION } from './session-bounds';
import { createLaneGate } from './workload';
import { inTransaction, type TransactionRunner, type Tx } from './tx';

/**
 * Room preparation on the competitive lane (ADR 0088). It may wait on
 * external consent while holding its transaction, so it takes at most
 * `budget` of the lane's connections (half), leaving the rest to Round
 * writers, and excess is refused at once, before any SQL, with the
 * capacity family.
 */
export function roomCommandTransaction(
  competitive: SQL,
  budget: number,
  waits: Waits,
): TransactionRunner {
  const gate = createLaneGate(
    'competitive',
    { connections: budget, queue: 0, maxWaitMs: 1 },
    waits,
  );
  return async <T>(run: (tx: Tx) => Promise<T>): Promise<T> => {
    const leave = await gate.admit();
    try {
      const bound = deadlineSignal(waits, RUNTIME_SESSION.lock_timeout);
      const reserved = await competitive
        .reserve({ signal: bound.signal })
        .finally(bound.clear)
        .catch((error: unknown) => {
          if (isAppError(error)) throw error;
          throw createAppError(
            'INFRASTRUCTURE',
            'Room connection unavailable',
            error,
          );
        });
      try {
        return await inTransaction(drizzle({ client: reserved }), run);
      } finally {
        reserved.release();
      }
    } finally {
      leave();
    }
  };
}
