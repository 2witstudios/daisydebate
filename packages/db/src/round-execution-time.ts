import { sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
type Tx = Pick<BunSQLDatabase, 'execute'>;
/** One separately sampled instant after every required transaction lock. */
export async function sampleRoundExecutionTime(tx: Tx): Promise<string> {
  const [row] = (await tx.execute(
    sql`select clock_timestamp() as now`,
  )) as unknown as { now: Date }[];
  if (!row) throw createAppError('INFRASTRUCTURE', 'The clock is unreadable');
  return row.now.toISOString();
}
