import { eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BoundedTransactionContext } from '../transaction-context';
import { sampleRoundExecutionTime } from '../round-execution-time';
import { nextEpoch } from '../lease-policy';
import { transcriptionRecoveryContexts as contexts } from '../schema/transcription-recovery';
import { due } from './discover';
import { lock } from './lock';
import { claimDigest, type Policy } from './policy';

export async function claim(
  tx: BoundedTransactionContext,
  input: { workerId: string; contextId: string; roundId: string },
  options: Policy & { nextToken: () => string },
) {
  const target = { contextId: input.contextId, roundId: input.roundId };
  {
    const owned = await lock(tx, target.contextId, target.roundId);
    const [eligible] =
      (await tx.execute(sql`select c.id from transcription_recovery_contexts c where c.id=${target.contextId} and ${due(options)}
   and not exists(select 1 from transcription_recovery_contexts live where live.round_id=c.round_id and live.status='leased' and live.lease_expires_at>clock_timestamp())`)) as unknown as {
        id: string;
      }[];
    if (!eligible) return { kind: 'idle' as const };
    const now = new Date(await sampleRoundExecutionTime(tx));
    if (
      owned.members.some(
        (unit) =>
          unit.state !== 'retained' ||
          !unit.payloadAcceptedAt ||
          !unit.expiresAt ||
          unit.expiresAt <= now,
      )
    )
      throw createAppError('CONFLICT');
    if (owned.context.attempts >= options.maxAttempts) {
      await tx
        .update(contexts)
        .set({
          status: 'blocked',
          blockedReason: 'budget',
          leaseDigest: null,
          leaseExpiresAt: null,
          lastClaimedAt: now,
        })
        .where(eq(contexts.id, target.contextId));
      return { kind: 'blocked' as const, ...target, reason: 'budget' as const };
    }
    const epoch = nextEpoch(
        owned.context.claimEpoch,
        'Recognition claim epoch exhausted',
      ),
      token = options.nextToken();
    const expiresAt = new Date(now.getTime() + options.leaseMs);
    await tx
      .update(contexts)
      .set({
        status: 'leased',
        workerId: input.workerId,
        claimEpoch: epoch,
        leaseDigest: claimDigest(token),
        leaseExpiresAt: expiresAt,
        lastClaimedAt: now,
        blockedReason: null,
        model: owned.context.model ?? options.model,
        policyDigest: owned.context.policyDigest ?? options.policyDigest,
      })
      .where(eq(contexts.id, target.contextId));
    return {
      kind: 'claimed' as const,
      ...target,
      claim: { workerId: input.workerId, epoch, token },
      expiresAt: expiresAt.toISOString(),
      evidenceIds: owned.members.map((unit) => unit.evidenceId),
      model: owned.context.model ?? options.model,
      policyDigest: owned.context.policyDigest ?? options.policyDigest,
    };
  }
}
