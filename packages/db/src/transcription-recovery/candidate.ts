import { and, eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BoundedTransactionContext } from '../transaction-context';
import { transcriptionRecoveryAttempts as attempts } from '../schema/transcription-recovery-attempts';
import { current } from './current';
import type { Claim, Policy } from './policy';
/** Only an application-computed digest/size enters PG. Provider success/candidate existence is never settlement. */
export async function candidate(
  tx: BoundedTransactionContext,
  input: Claim & { digest: string; bytes: number },
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
  if (
    !attempt ||
    (attempt.candidateDigest !== null &&
      attempt.candidateDigest !== input.digest)
  )
    throw createAppError('CONFLICT');
  if (!attempt.candidateDigest)
    await tx
      .update(attempts)
      .set({
        outcome: 'candidate',
        candidateDigest: input.digest,
        candidateBytes: input.bytes,
        completedAt: owned.now,
      })
      .where(
        and(
          eq(attempts.contextId, input.contextId),
          eq(attempts.claimEpoch, input.claim.epoch),
        ),
      );
  return {
    kind: 'provisional' as const,
    digest: input.digest,
    ordinal: attempt.ordinal,
  };
}
