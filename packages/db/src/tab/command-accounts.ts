import { inArray } from 'drizzle-orm';
import { lockAuthorizationActors } from '../authorization';
import { actors } from '../schema/actors';
import type { TabTransaction } from './tab-transaction';

/**
 * Authority mutations and erasure take the same account fence. Acquire it
 * before aggregate locks, in canonical user order, so neither can invalidate
 * a command's account facts while its writes are being applied.
 */
export const lockTabCommandAccounts = async (
  tx: TabTransaction,
  userIds: readonly string[],
): Promise<void> => {
  const rows = await tx
    .select({ id: actors.id })
    .from(actors)
    .where(inArray(actors.userId, [...new Set(userIds)]));
  if (rows.length > 0)
    await lockAuthorizationActors(
      tx,
      rows.map((row) => row.id),
      { maxActors: rows.length },
    );
};
