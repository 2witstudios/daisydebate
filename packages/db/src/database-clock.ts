import { sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { z } from 'zod';
import { query } from './raw-rows';
import type { Tx } from './tx';

export const databaseClockRow = z.object({ now: z.date() });

/** Sample only after every fact/authority lock required by the caller. */
export async function readDatabaseTime(tx: Tx) {
  const [row] = await query(
    tx,
    databaseClockRow,
    sql`select clock_timestamp() as now`,
  );
  if (!row) throw createAppError('INFRASTRUCTURE', 'The clock is unreadable');
  return row.now;
}
