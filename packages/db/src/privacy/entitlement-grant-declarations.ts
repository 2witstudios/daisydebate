import { sql } from 'drizzle-orm';
import type { PrivacyFieldDeclaration } from '@daisy/protocol/privacy';
import type { PrivacyAdopter } from './contracts';

const field = (
  column: string,
  category: 'identifier' | 'personal',
): PrivacyFieldDeclaration => ({
  table: 'account_entitlement_grants',
  column,
  category,
  ...(category === 'personal' ? { visibility: 'private' as const } : {}),
  storage: 'postgres',
  owner: 'ENTITLEMENTS',
  purpose: 'Premium entitlements an account holds (DEC-247)',
  lawfulBasis: { status: 'pending', decision: 'jc0qcdvpkmqzrelpaesi3pah' },
  retention: { status: 'pending', decision: 'njiorsf64z4iqjm2dbfa3zuu' },
  erasure: 'delete',
  exportable: true,
});

export const entitlementGrantPrivacyExpectedColumns = {
  account_entitlement_grants: [
    'user_id',
    'entitlement',
    'source',
    'created_at',
  ],
};

/** Erasure deletes the subject's grants; export returns them. */
export const entitlementGrantPrivacyAdopter: PrivacyAdopter = {
  id: 'entitlement-grants',
  phase: 'after-scrub',
  fields: [
    field('user_id', 'identifier'),
    field('entitlement', 'personal'),
    field('source', 'personal'),
    field('created_at', 'personal'),
  ],
  erase: async (tx, subject) => {
    await tx.execute(
      sql`delete from account_entitlement_grants where user_id = ${subject.userId}`,
    );
  },
  export: async (tx, subject) => {
    const rows = (await tx.execute(sql`select entitlement, source,
        to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
      from account_entitlement_grants where user_id = ${subject.userId}
      order by entitlement, source`)) as unknown as Record<string, unknown>[];
    return { account_entitlement_grants: rows };
  },
};
