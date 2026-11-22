import { sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol/primitives';
import type { Tx } from './tx';
import { query } from './raw-rows';
import { z } from 'zod';

/** The user-row fence shared by account-level writes and subject erasure. */
export async function lockOpenAccount(tx: Tx, userId: string): Promise<void> {
  if (!idSchema.safeParse(userId).success) throw createAppError('VALIDATION');
  const [user] = await query(
    tx,
    z.object({ erased: z.boolean() }),
    sql`select deleted_at is not null as erased from users where id=${userId} for update`,
  );
  if (!user || user.erased) throw createAppError('AUTHORIZATION');
}
