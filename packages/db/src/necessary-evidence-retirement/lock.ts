import { eq } from 'drizzle-orm';
import type { BoundedTransactionContext } from '../transaction-context';
import { rounds } from '../schema/rounds';
import { necessaryEvidence } from '../schema/necessary-evidence';
/** Destructive cleanup never requires now-erased subjects. No account lock follows Round. Payload is never selected. */
export async function lock(tx: BoundedTransactionContext, evidenceId: string) {
  const [scope] = await tx
    .select({ roundId: necessaryEvidence.roundId })
    .from(necessaryEvidence)
    .where(eq(necessaryEvidence.id, evidenceId));
  if (!scope) return null;
  if (scope.roundId)
    await tx
      .select({ id: rounds.id })
      .from(rounds)
      .where(eq(rounds.id, scope.roundId))
      .for('no key update');
  const [row] = await tx
    .select({
      id: necessaryEvidence.id,
      roundId: necessaryEvidence.roundId,
      originalRoundId: necessaryEvidence.originalRoundId,
      authorityId: necessaryEvidence.authorityId,
      bindingDigest: necessaryEvidence.bindingDigest,
      state: necessaryEvidence.state,
      retirementReason: necessaryEvidence.retirementReason,
      executionWorkerId: necessaryEvidence.executionWorkerId,
      executionEpoch: necessaryEvidence.executionEpoch,
      leaseDigest: necessaryEvidence.leaseDigest,
      leaseExpiresAt: necessaryEvidence.leaseExpiresAt,
    })
    .from(necessaryEvidence)
    .where(eq(necessaryEvidence.id, evidenceId))
    .for('update');
  if (!row || (row.roundId !== scope.roundId && row.roundId !== null))
    return null;
  return row;
}
