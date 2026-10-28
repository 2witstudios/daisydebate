import type { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql/postgres';
import { createAppError, isAppError } from '@daisy/errors';
import type { Tx } from './room-command-facts';
import { RUNTIME_SESSION } from './session-bounds';

/**
 * Room preparation on the competitive lane (ADR 0088): the reservation is
 * admitted by the lane, so a full lane refuses with the capacity family
 * instead of a private counter's own error.
 */
export function roomCommandTransaction(competitive: SQL) {
  return async <T>(run: (tx: Tx) => Promise<T>): Promise<T> => {
    const reserved = await competitive
      .reserve({
        signal: AbortSignal.timeout(RUNTIME_SESSION.lock_timeout),
      })
      .catch((error: unknown) => {
        if (isAppError(error)) throw error;
        throw createAppError(
          'INFRASTRUCTURE',
          'Room connection unavailable',
          error,
        );
      });
    try {
      return await drizzle({ client: reserved }).transaction(run);
    } finally {
      reserved.release();
    }
  };
}
