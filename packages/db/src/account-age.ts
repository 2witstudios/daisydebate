import { sql } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import type { AuthorizationTransaction } from './authorization';
import { accountAge } from './schema/account-age';
/** Same account-fenced transaction as send/contact/erasure; no external pool. */
export async function loadAccountAgeSource(
  tx: AuthorizationTransaction,
  userId: string,
) {
  if (!idSchema.safeParse(userId).success) throw createAppError('VALIDATION');
  const rows = (await tx.execute(
    sql`select birth_month as "birthMonth",version as revision,recorded_at as "recordedAt" from ${accountAge} where user_id=${userId}`,
  )) as unknown as { birthMonth: string; revision: number; recordedAt: Date }[];
  const row = rows[0];
  return row
    ? {
        birthMonth: row.birthMonth,
        revision: row.revision,
        recordedAt: row.recordedAt.toISOString(),
      }
    : null;
}
