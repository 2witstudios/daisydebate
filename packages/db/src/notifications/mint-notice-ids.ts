import { sql, type SQL } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { z } from 'zod';
import { query } from '../raw-rows';
import type { Tx } from '../tx';

const slotRow = z.object({ slots: z.number().int().nonnegative() });

/** The database chooses the private audience. The application supplies its CUIDs. */
export async function mintNoticeIds(
  tx: Pick<Tx, 'execute'>,
  operation: SQL,
  args: SQL,
  nextId: () => string,
) {
  const [plan] = await query(
    tx,
    slotRow,
    sql`select ${operation}(${args}) as slots`,
  );
  let slots = plan?.slots ?? 0;
  for (let attempt = 0; slots > 0; attempt += 1) {
    if (attempt === 3) throw createAppError('INFRASTRUCTURE');
    const ids = Array.from({ length: slots }, () => sql`${nextId()}`);
    const [result] = await query(
      tx,
      slotRow,
      sql`select ${operation}(${args}, ARRAY[${sql.join(ids, sql`,`)}]::text[]) as slots`,
    );
    slots = result?.slots ?? 0;
  }
}
