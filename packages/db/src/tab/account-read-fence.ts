import { eq } from 'drizzle-orm';
import { readAuthorizationActors } from '../authorization';
import { actors } from '../schema/actors';
import type { TabTransaction } from './tab-transaction';
/** The subject's shared canonical account fence, before any aggregate metadata fence. */
export const fenceTabAccountRead = async (
  tx: TabTransaction,
  viewerUserId: string,
): Promise<void> => {
  const [viewer] = await tx
    .select({ id: actors.id })
    .from(actors)
    .where(eq(actors.userId, viewerUserId));
  if (viewer) await readAuthorizationActors(tx, [viewer.id], { maxActors: 1 });
};
