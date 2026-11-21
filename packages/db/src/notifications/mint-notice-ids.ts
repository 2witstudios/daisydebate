import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { query, run } from '../raw-rows';
import type { Tx } from '../tx';

/** The database chooses the private audience. The application supplies its CUIDs. */
export async function mintNoticeIds(
  tx: Pick<Tx, 'execute'>,
  operation: SQL,
  args: SQL,
  nextId: () => string,
) {
  const [plan] = await query(
    tx,
    z.object({ slots: z.number().int().nonnegative() }),
    sql`select ${operation}(${args}) as slots`,
  );
  if (!plan?.slots) return;
  const ids = Array.from({ length: plan.slots }, () => sql`${nextId()}`);
  await run(
    tx,
    sql`select ${operation}(${args}, ARRAY[${sql.join(ids, sql`,`)}]::text[])`,
  );
}
