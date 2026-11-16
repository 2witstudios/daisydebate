import { inArray } from 'drizzle-orm';
import { readAuthorizationActors } from '../authorization';
import { actors } from '../schema/actors';
import type { TabTransaction } from './tab-transaction';
/** The subject's shared canonical account fence, before any aggregate metadata fence. */
export const fenceTabAccountsRead = async (
  tx: TabTransaction,
  userIds: readonly string[],
): Promise<void> => {
  if (userIds.length === 0) return;
  const people = await tx
    .select({ id: actors.id })
    .from(actors)
    .where(inArray(actors.userId, [...userIds]));
  if (people.length)
    await readAuthorizationActors(
      tx,
      people.map((person) => person.id),
      { maxActors: people.length },
    );
};

export const fenceTabAccountRead = (
  tx: TabTransaction,
  viewerUserId: string,
): Promise<void> => fenceTabAccountsRead(tx, [viewerUserId]);
