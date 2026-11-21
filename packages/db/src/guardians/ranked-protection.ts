import { createRefusal } from '@daisy/errors';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { query } from '../raw-rows';
import type { Tx } from '../tx';
import { currentTenantScope, scopeTransaction } from '../tenant-scope';

/** Called with the prospective entrants' account fences held. Bots have no user. */
export async function rankedProtectionAllows(
  tx: Pick<Tx, 'execute'>,
  actorIds: readonly string[],
  scope: { readonly userId: string; readonly roomId?: string },
): Promise<boolean> {
  if (!actorIds.length) return true;
  const previous = await currentTenantScope(tx);
  await scopeTransaction(tx, { ...previous, subjectUserId: scope.userId });
  const [row] = await query(
    tx,
    z.object({ allowed: z.boolean().nullable() }),
    sql`select public.daisy_ranked_protection_allows(ARRAY[${sql.join(
      actorIds.map((actorId) => sql`${actorId}`),
      sql`,`,
    )}]::text[], ${scope.roomId ?? null}::text) as allowed`,
  );
  await scopeTransaction(tx, previous);
  return row?.allowed === true;
}

export async function requireRankedProtection(
  tx: Pick<Tx, 'execute'>,
  actorIds: readonly string[],
  scope: { readonly userId: string; readonly roomId?: string },
): Promise<void> {
  if (!(await rankedProtectionAllows(tx, actorIds, scope)))
    throw createRefusal('CONFLICT', 'ranked-unavailable');
}
