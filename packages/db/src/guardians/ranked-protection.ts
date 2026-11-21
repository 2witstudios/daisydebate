import { createRefusal } from '@daisy/errors';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { query } from '../raw-rows';
import type { Tx } from '../tx';

/** Called with the prospective entrants' account fences held. Bots have no user. */
export async function rankedProtectionAllows(
  tx: Pick<Tx, 'execute'>,
  actorIds: readonly string[],
): Promise<boolean> {
  if (!actorIds.length) return true;
  const [row] = await query(
    tx,
    z.object({ allowed: z.boolean() }),
    sql`select public.daisy_ranked_protection_allows(ARRAY[${sql.join(
      actorIds.map((actorId) => sql`${actorId}`),
      sql`,`,
    )}]::text[]) as allowed`,
  );
  return row!.allowed;
}

export async function requireRankedProtection(
  tx: Pick<Tx, 'execute'>,
  actorIds: readonly string[],
): Promise<void> {
  if (!(await rankedProtectionAllows(tx, actorIds)))
    throw createRefusal('CONFLICT', 'ranked-unavailable');
}
