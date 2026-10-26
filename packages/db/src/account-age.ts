import { sql } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import type { AuthorizationTransaction } from './authorization';
import type { PrivacyFieldDeclaration } from '@daisy/protocol/privacy';
import type { PrivacyAdopter } from './privacy/contracts';
import { accountAge } from './schema/account-age';
export { loadAuthorizationAgeFact } from './authorization-age';
export { bindAuthorizationAgeFact } from './authorization-age-reader';
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

const accountAgePrivacyFields: readonly PrivacyFieldDeclaration[] = [
  'user_id',
  'birth_month',
  'version',
  'recorded_at',
].map((column) => ({
  table: 'account_age',
  column,
  category:
    column === 'birth_month'
      ? 'personal'
      : column === 'user_id'
        ? 'identifier'
        : 'none',
  ...(column === 'birth_month' ? { visibility: 'private' as const } : {}),
  storage: 'postgres',
  owner: 'WAIT',
  purpose: 'Minimum durable source for current account age eligibility',
  lawfulBasis: { status: 'pending', decision: 'sznp9ay8e88ny2sg4xujosae' },
  retention: { status: 'pending', decision: 'njiorsf64z4iqjm2dbfa3zuu' },
  erasure: 'delete',
  exportable: true,
}));
export const accountAgePrivacyAdopter: PrivacyAdopter = {
  id: 'account-age',
  phase: 'after-scrub',
  fields: accountAgePrivacyFields,
  erase: async (tx, subject) => {
    await tx.execute(
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
