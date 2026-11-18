import { eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { rounds } from './schema/rounds';

/**
 * Whether a Round is a Youth one (ADR 0150): ranked on the Youth division,
 * frozen at Start. Null when there is no such Round. Its live audience reads
 * this before reading anyone's links (ADR 0155).
 */
export const readRoundYouth = async (
  database: Pick<BunSQLDatabase, 'select'>,
  roundId: string,
): Promise<boolean | null> => {
  const [row] = await database
    .select({
      competitionType: rounds.competitionType,
      division: rounds.ladderDivision,
    })
    .from(rounds)
    .where(eq(rounds.id, roundId));
  return row
    ? row.competitionType === 'ranked' && row.division === 'youth'
    : null;
};
