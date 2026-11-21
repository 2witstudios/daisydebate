import { createAppError } from '@daisy/errors';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  protectionLevelSchema,
  type ProtectionLevel,
} from '@daisy/protocol/protection-level';
import { query } from '../raw-rows';
import type { Tx } from '../tx';

export async function readProtectionLevel(
  tx: Pick<Tx, 'execute'>,
  userId: string,
): Promise<ProtectionLevel | null> {
  const [row] = await query(
    tx,
    z.object({ choice: protectionLevelSchema.nullable() }),
    sql`select public.daisy_protection_level(${userId}) as choice`,
  );
  return row?.choice ?? null;
}

export async function messageRequestsFriendsOnly(
  tx: Pick<Tx, 'execute'>,
  userId: string,
): Promise<boolean> {
  const [row] = await query(
    tx,
    z.object({ friends_only: z.boolean() }),
    sql`select public.daisy_message_requests_friends_only(${userId}) as friends_only`,
  );
  if (!row) throw createAppError('INFRASTRUCTURE');
  return row.friends_only;
}
