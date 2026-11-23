import { eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol/primitives';
import { casualUsageSponsorRefusal } from '@daisy/protocol/usage-sponsor';
import { lockAuthorizationActors } from './authorization';
import { rounds } from './schema/rounds';
import type { Tx } from './tx';

type Target = { readonly actorId: string; readonly roundId: string };

/** An admission names its sponsor and its Round by cuid2. */
export function requireAdmissionTarget(target: Target): void {
  if (
    ![target.actorId, target.roundId].every(
      (id) => idSchema.safeParse(id).success,
    )
  )
    throw createAppError('VALIDATION');
}

/**
 * Locks the sponsor's account (FOR KEY SHARE, the account fence) and then
 * its Round (FOR NO KEY UPDATE), and applies the protocol's sponsor rule to
 * what it read. Returns the locked account.
 */
export async function lockUsageSponsor(tx: Tx, target: Target) {
  requireAdmissionTarget(target);
  const [account] = await lockAuthorizationActors(tx, [target.actorId], {
    maxActors: 1,
  });
  const [round] = await tx
    .select()
    .from(rounds)
    .where(eq(rounds.id, target.roundId))
    .for('no key update');
  const refusal = casualUsageSponsorRefusal(
    account ?? null,
    round,
    target.actorId,
  );
  if (refusal) throw createAppError(refusal);
  return account ?? null;
}
