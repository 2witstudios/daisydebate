import { eq, sql } from 'drizzle-orm';
import { lobbies } from '../schema/lobbies';
import type { Tx } from '../tx';
/** The public address identity only; the named read still authorizes its actual lobby. */
export const findLobbyByHandle = async (
  tx: Tx,
  handle: string,
): Promise<string | null> => {
  const [row] = await tx
    .select({ id: lobbies.id })
    .from(lobbies)
    .where(eq(sql`lower(${lobbies.handle})`, handle.toLowerCase()))
    .limit(1);
  return row?.id ?? null;
};
