import { sql } from 'drizzle-orm';
import type { PrivacyAdopter } from './privacy/contracts';

/** Erasure deletes the subject's grants; export returns them. */
export const entitlementGrantPrivacyAdopter: PrivacyAdopter = {
  id: 'entitlement-grants',
  phase: 'after-scrub',
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
