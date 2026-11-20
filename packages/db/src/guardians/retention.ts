import { sql } from 'drizzle-orm';
import type { AuthorizationTransaction } from '../authorization';
import { rowsOf } from '../raw-rows';

export async function expireGuardianRequests(
  tx: Pick<AuthorizationTransaction, 'execute'>,
  limit: number,
  eraseSubject = false,
): Promise<number> {
  const [row] = await rowsOf<{ count: number }>(
    tx,
    sql`
    select public.daisy_expire_child_account_requests(${limit}::integer, ${eraseSubject}) as count
  `,
  );
  return row?.count ?? 0;
}
