import { eq, sql } from 'drizzle-orm';
import type { Tx } from './tx';
import { rounds } from './schema/rounds';

/** The age rule classification of a Round's Room, read before linked-adult facts. */
export const readRoundYouth = async (
  database: Pick<Tx, 'select'>,
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
