import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { eq, sql } from 'drizzle-orm';
import type { CaptureTx } from './media-capture-context';
import { rounds } from './schema/rounds';
import { necessaryEvidenceRounds } from './schema/necessary-evidence-rounds';
import { necessaryEvidence } from './schema/necessary-evidence';
/** Internal revoker only; Round fence commits before custody, never a vendor call in this transaction. */
export async function withdrawRoundEvidence(tx: CaptureTx, roundId: string) {
  if (!idSchema.safeParse(roundId).success) throw createAppError('VALIDATION');
  const [round] = await tx
    .select({ id: rounds.id })
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .for('no key update');
  if (!round) throw createAppError('NOT_FOUND');
  const [fence] = await tx
    .insert(necessaryEvidenceRounds)
    .values({ roundId, withdrawnAt: sql`clock_timestamp()` })
    .onConflictDoUpdate({
      target: necessaryEvidenceRounds.roundId,
      set: {
        withdrawnAt: sql`coalesce(${necessaryEvidenceRounds.withdrawnAt},clock_timestamp())`,
      },
    })
    .returning({ withdrawnAt: necessaryEvidenceRounds.withdrawnAt });
  if (!fence?.withdrawnAt) throw createAppError('INFRASTRUCTURE');
  return { withdrawnAt: fence.withdrawnAt.toISOString() };
}

/** Caller holds Round. Only a genuinely new scope may create its initial open fence. */
export async function requireRoundEvidenceOpen(
  tx: CaptureTx,
  roundId: string,
  initial = false,
) {
  const [known] = await tx
    .select()
    .from(necessaryEvidenceRounds)
    .where(eq(necessaryEvidenceRounds.roundId, roundId));
  if (known) {
    if (known.withdrawnAt)
      throw createAppError('CONFLICT', 'Necessary evidence was withdrawn');
    return;
  }
  if (!initial)
    throw createAppError(
      'CONFLICT',
      'Evidence withdrawal authority is unknown',
    );
  const [prior] = await tx
    .select({ id: necessaryEvidence.id })
    .from(necessaryEvidence)
    .where(eq(necessaryEvidence.originalRoundId, roundId))
    .limit(1);
  if (prior)
    throw createAppError(
      'CONFLICT',
      'Evidence withdrawal authority is unknown',
    );
  await tx.insert(necessaryEvidenceRounds).values({ roundId });
}
