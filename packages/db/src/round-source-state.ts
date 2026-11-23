import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { parsedColumn } from './raw-rows';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { roundSourceVoids } from './schema/round-source-voids';

/** Source validity is independent of a retained historical Round ending. */
export const roundSourceVoided = (roundId: string | SQL | AnyPgColumn) =>
  parsedColumn(
    z.boolean(),
    sql`exists(select 1 from ${roundSourceVoids} where ${roundSourceVoids.roundId}=${roundId})`,
  );
