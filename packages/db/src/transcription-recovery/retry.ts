import { and, eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { transcriptionRecoveryContexts as contexts } from '../schema/transcription-recovery';
import { transcriptionRecoveryAttempts as attempts } from '../schema/transcription-recovery-attempts';
import { current } from './current';
import type { Claim, Policy } from './policy';
import type { Tx } from '../tx';
/** Lease/capacity is released before persisted backoff. No failure manufactures authoritative text or settlement. */
export async function retry(
  tx: Tx,
  input: Claim & { reason: 'provider' | 'quality' | 'uncertain' },
  options: Policy,
) {
  const owned = await current(tx, input, options);
  const [attempt] = await tx
    .select()
    .from(attempts)
    .where(
      and(
        eq(attempts.contextId, input.contextId),
        eq(attempts.claimEpoch, input.claim.epoch),
      ),
    );
  if (attempt) {
    if (input.reason === 'provider' && attempt.candidateDigest)
      throw createAppError('CONFLICT');
    await tx
      .update(attempts)
      .set({
        outcome:
          input.reason === 'quality'
            ? 'quality_review'
            : input.reason === 'provider'
              ? 'provider_failure'
              : 'uncertain',
        completedAt: attempt.completedAt ?? owned.now,
      })
      .where(
        and(
          eq(attempts.contextId, input.contextId),
          eq(attempts.claimEpoch, input.claim.epoch),
        ),
      );
  }
  const exhausted = owned.context.attempts >= options.maxAttempts;
  const blocked = exhausted || input.reason === 'quality';
  const due = new Date(
    owned.now.getTime() +
      Math.min(
        300000,
        options.retryBaseMs * 2 ** Math.min(owned.context.attempts, 9),
      ),
  );
  await tx
    .update(contexts)
    .set({
      status: blocked ? 'blocked' : 'retry',
      blockedReason: blocked ? (exhausted ? 'budget' : 'quality') : null,
      nextAttemptAt: due,
      leaseDigest: null,
      leaseExpiresAt: null,
    })
    .where(eq(contexts.id, input.contextId));
  return blocked
    ? {
        kind: 'blocked' as const,
        reason: exhausted ? ('budget' as const) : ('quality' as const),
      }
    : { kind: 'retry' as const, retryAt: due.toISOString() };
}
