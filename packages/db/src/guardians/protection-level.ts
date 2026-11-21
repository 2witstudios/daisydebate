import { sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  protectionLevelSchema,
  protectionLimits,
  type ProtectionLevel,
} from '@daisy/protocol/protection-level';
import { query } from '../raw-rows';
import type { Tx } from '../tx';

export async function readProtectionLevel(
  tx: Pick<Tx, 'execute'>,
  userId: string,
): Promise<ProtectionLevel> {
  const [row] = await query(
    tx,
    z.object({ choice: protectionLevelSchema }),
    sql`select public.daisy_protection_level(${userId}) as choice`,
  );
  return row!.choice;
}

export async function readProtectionLimits(
  tx: Pick<Tx, 'execute'>,
  userId: string,
) {
  return protectionLimits(await readProtectionLevel(tx, userId));
}

export async function activeGuardianUsers(
  tx: Pick<Tx, 'execute'>,
  childActorId: string,
) {
  return query(
    tx,
    z.object({ user_id: z.string() }),
    sql`select g.user_id from actors child
      cross join lateral public.daisy_protection_guardians(child.user_id) g
      where child.id=${childActorId}`,
  );
}
