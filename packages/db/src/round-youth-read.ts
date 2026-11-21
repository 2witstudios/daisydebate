import { eq, sql } from 'drizzle-orm';
import { rounds } from './schema/rounds';
import type { Tx } from './tx';

/** The age rule classification of a Round's Room, read before linked-adult facts. */
export const readRoundYouth = async (
  database: Tx,
  roundId: string,
): Promise<boolean | null> => {
  const [row] = await database
    .select({
      youth: sql<boolean | null>`public.daisy_room_is_youth(${rounds.roomId})`,
    })
    .from(rounds)
    .where(eq(rounds.id, roundId));
  return row?.youth ?? null;
};
