import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { query } from '../raw-rows';
import type { Tx } from '../tx';

const expiryCount = z.object({ count: z.number().int().nonnegative() });

export async function expireGuardianRequests(
  tx: Pick<Tx, 'execute'>,
  limit: number,
): Promise<number> {
  const [row] = await query(
    tx,
    expiryCount,
    sql`
    select public.daisy_expire_child_account_requests(${limit}::integer) as count
  `,
  );
  return row?.count ?? 0;
}
