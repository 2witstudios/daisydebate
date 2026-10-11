import type { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import type { Tx } from './room-command-facts';
import { RUNTIME_SESSION } from './session-bounds';

/** Room preparation shares the existing pool, with no queued admission waiters. */
export function roomCommandTransaction(client: SQL, maxConnections: number) {
  if (!Number.isSafeInteger(maxConnections) || maxConnections < 1)
    throw createAppError('VALIDATION', 'Invalid database pool capacity');
  const limit = Math.max(1, Math.floor(maxConnections / 2));
  let active = 0;
  return async <T>(run: (tx: Tx) => Promise<T>): Promise<T> => {
    if (active >= limit)
      throw createAppError(
        'INFRASTRUCTURE',
        'Room command capacity unavailable',
      );
    active += 1;
    try {
      const reserved = await client
        .reserve({
          signal: AbortSignal.timeout(RUNTIME_SESSION.lock_timeout),
        })
        .catch((error: unknown) => {
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
    } finally {
      active -= 1;
    }
  };
}
