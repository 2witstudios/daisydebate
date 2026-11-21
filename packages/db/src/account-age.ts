import { sql } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import type { PrivacyAdopter } from './privacy/contracts';
import { accountAge } from './schema/account-age';
import type { Tx } from './tx';
import { run, query } from './raw-rows';
import { z } from 'zod';
export { loadAuthorizationAgeFact } from './authorization-age';
export { bindAuthorizationAgeFact } from './authorization-age-reader';
/** Same account-fenced transaction as send/contact/erasure; no external pool. */
export async function loadAccountAgeSource(tx: Tx, userId: string) {
  if (!idSchema.safeParse(userId).success) throw createAppError('VALIDATION');
  const rows = await query(
    tx,
    z.object({
      birthMonth: z.string(),
      revision: z.number(),
      recordedAt: z.unknown(),
    }),
    sql`select birth_month as "birthMonth",version as revision,recorded_at as "recordedAt" from ${accountAge} where user_id=${userId}`,
  );
  const row = rows[0];
  return row &&
    row.recordedAt instanceof Date &&
    Number.isFinite(row.recordedAt.getTime())
    ? {
        birthMonth: row.birthMonth,
        revision: row.revision,
        recordedAt: row.recordedAt.toISOString(),
      }
    : null;
}

export const accountAgePrivacyAdopter: PrivacyAdopter = {
  id: 'account-age',
  phase: 'after-close',
  erase: async (tx, subject) => {
    await run(
      tx,
      sql`delete from ${accountAge} where user_id=${subject.userId}`,
    );
  },
  export: async (tx, subject) => {
    const source = await loadAccountAgeSource(tx, subject.userId);
    return {
      account_age: source
        ? [
            {
              user_id: subject.userId,
              birth_month: source.birthMonth,
              version: source.revision,
              recorded_at: source.recordedAt,
            },
          ]
        : [],
    };
  },
};
