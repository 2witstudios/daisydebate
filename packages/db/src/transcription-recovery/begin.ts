import { and, eq } from 'drizzle-orm';
import type { BoundedTransactionContext } from '../transaction-context';
import { transcriptionRecoveryContexts as contexts } from '../schema/transcription-recovery';
import { transcriptionRecoveryAttempts as attempts } from '../schema/transcription-recovery-attempts';
import { current } from './current';
import type { Claim, Policy } from './policy';
/** Conservative call admission commits before external I/O. A lost admission acknowledgement is never permission to repeat that epoch. */
export async function begin(
  tx: BoundedTransactionContext,
  input: Claim,
  options: Policy,
) {
  const owned = await current(tx, input, options);
  const [existing] = await tx
    .select({ ordinal: attempts.ordinal })
    .from(attempts)
    .where(
      and(
        eq(attempts.contextId, input.contextId),
        eq(attempts.claimEpoch, input.claim.epoch),
      ),
    );
  if (existing)
    return { kind: 'already-admitted' as const, ordinal: existing.ordinal };
  if (owned.context.attempts >= options.maxAttempts) {
    await tx
      .update(contexts)
      .set({
        status: 'blocked',
        blockedReason: 'budget',
        leaseDigest: null,
        leaseExpiresAt: null,
      })
      .where(eq(contexts.id, input.contextId));
    return { kind: 'blocked' as const, reason: 'budget' as const };
  }
  const ordinal = owned.context.attempts + 1;
  await tx.insert(attempts).values({
    contextId: input.contextId,
    claimEpoch: input.claim.epoch,
    ordinal,
    outcome: 'admitted',
    admittedAt: owned.now,
  });
  await tx
    .update(contexts)
    .set({ attempts: ordinal })
    .where(eq(contexts.id, input.contextId));
  return { kind: 'admitted' as const, ordinal };
}
