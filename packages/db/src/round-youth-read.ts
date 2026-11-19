import { eq } from 'drizzle-orm';
import { rooms } from './schema/rooms';
import { rounds } from './schema/rounds';
import type { Tx } from './tx';

/**
 * Whether a Round's Room is in the Youth lobby (ADR 0156): a Room's division
 * is fixed when it is created, so its Round's is too. Null when there is no
 * such Round, or it has no Room. A live audience reads this before reading
 * anyone's links (ADR 0155), the same division `canWatchLive` decides by.
 */
export const readRoundYouth = async (
  database: Tx,
  roundId: string,
): Promise<boolean | null> => {
  const [row] = await database
    .select({ division: rooms.division })
    .from(rounds)
    .innerJoin(rooms, eq(rooms.id, rounds.roomId))
    .where(eq(rounds.id, roundId));
  return row ? row.division === 'youth' : null;
};
