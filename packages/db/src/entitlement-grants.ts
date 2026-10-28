import {
  entitlementKinds,
  entitlementSources,
  type EntitlementGrant,
} from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { z } from 'zod';

type Executor = Pick<BunSQLDatabase, 'execute'>;

const grantRow = z.object({
  entitlement: z.enum(entitlementKinds),
  source: z.enum(entitlementSources),
});

/**
 * An account's entitlement grants. Read inside the caller's transaction:
 * a claim that holds the account's canonical fence reads grants that the
 * beta command, which bumps the same fence, cannot change underneath it.
 */
export async function readEntitlementGrants(
  tx: Executor,
  userId: string,
): Promise<readonly EntitlementGrant[]> {
  const rows = (await tx.execute(sql`select entitlement, source
    from account_entitlement_grants where user_id = ${userId}
    order by entitlement, source`)) as unknown as unknown[];
  return rows.map((row) => grantRow.parse(row));
}

/** What beta approval grants (DEC-247, DEC-183): round analysis and AI rounds. */
const betaGrants = ['round_analysis', 'ai_rounds'] as const;

/**
 * Writes the account's `beta` grants for its new beta state, in the beta
 * access command's transaction: approval grants them and any other state
 * removes them.
 */
export async function applyBetaEntitlementGrants(
  tx: Executor,
  userId: string,
  state: 'approved' | 'revoked',
) {
  if (state === 'approved')
    await tx.execute(sql`insert into account_entitlement_grants (user_id, entitlement, source)
      select ${userId}, entitlement, 'beta' from unnest(${`{${betaGrants.join(',')}}`}::text[]) as entitlement
      on conflict do nothing`);
  else
    await tx.execute(
      sql`delete from account_entitlement_grants where user_id = ${userId} and source = 'beta'`,
    );
}
