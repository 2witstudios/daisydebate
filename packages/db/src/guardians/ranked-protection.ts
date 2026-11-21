import { createRefusal } from '@daisy/errors';
import {
  protectionLevelSchema,
  protectionLimits,
} from '@daisy/protocol/protection-level';
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
  const choices = await query(
    tx,
    z.object({ choice: protectionLevelSchema }),
    sql`select public.daisy_protection_level(a.user_id) as choice from actors a
      where a.user_id is not null and a.id in (${sql.join(
        actorIds.map((actorId) => sql`${actorId}`),
        sql`,`,
      )})`,
  );
  return choices.every(({ choice }) => protectionLimits(choice).rankedAllowed);
}

export async function requireRankedProtection(
  tx: Pick<Tx, 'execute'>,
  actorIds: readonly string[],
): Promise<void> {
  if (!(await rankedProtectionAllows(tx, actorIds)))
    throw createRefusal('CONFLICT', 'ranked-unavailable');
}
