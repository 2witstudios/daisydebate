import { eq, sql } from 'drizzle-orm';
import type { Tx } from './tx';
import { rounds } from './schema/rounds';
import { youthRoundSql } from './youth-round-sql';

/** The age rule classification of a Round's Room, read before linked-adult facts. */
export const readRoundYouth = async (
  database: Pick<Tx, 'select'>,
  roundId: string,
): Promise<boolean | null> => {
  const [row] = await database
    .select({
      youth: youthRoundSql(sql`${rounds.id}`),
    })
    .from(rounds)
    .where(eq(rounds.id, roundId));
  return row?.youth ?? null;
};
