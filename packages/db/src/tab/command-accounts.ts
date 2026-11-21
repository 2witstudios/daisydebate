import { createAppError } from '@daisy/errors';
import { users } from '../schema/users';
import { eq, inArray, sql } from 'drizzle-orm';
import { lockAuthorizationActors } from '../authorization';
import { actors } from '../schema/actors';
import type { Tx } from '../tx';

/**
 * Authority mutations and erasure take the same account fence. Acquire it
 * before aggregate locks, in canonical user order, so neither can invalidate
 * a command's account facts while its writes are being applied.
 */
export const lockTabCommandAccounts = async (
  tx: Tx,
  userIds: readonly string[],
): Promise<void> => {
  const rows = await tx
    .select({ id: actors.id })
    .from(actors)
    .where(inArray(actors.userId, [...new Set(userIds)]));
  if (rows.length > 0)
    await lockAuthorizationActors(
      tx,
      rows.map((row) => row.id),
      { maxActors: rows.length },
    );
};

export type AccountRevisionWrite = {
  readonly table: 'users';
  readonly op: 'update';
  readonly id: string;
  readonly increment: 'version';
};

/** Membership and grant changes invalidate cached authority for that account. */
export const bumpTabAccountRevision = async (
  tx: Tx,
  userId: string,
): Promise<void> => {
  const rows = await tx
    .update(users)
    .set({ version: sql`${users.version} + 1` })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  if (rows.length !== 1)
    throw createAppError('INVARIANT', 'Authority account is missing');
};
