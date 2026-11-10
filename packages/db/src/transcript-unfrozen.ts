import { eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BoundedTransactionContext } from './transaction-context';
import { roundTranscriptFreezes } from './schema/round-transcript-freezes';

/**
 * Refuses once the Round's transcript is frozen: nothing more may be written
 * to it. The caller already holds the Round's lock, which orders this
 * against the freeze.
 */
export async function requireTranscriptUnfrozen(
  tx: Pick<BoundedTransactionContext, 'select'>,
  roundId: string,
) {
  const [freeze] = await tx
    .select({ id: roundTranscriptFreezes.roundId })
    .from(roundTranscriptFreezes)
    .where(eq(roundTranscriptFreezes.roundId, roundId));
  if (freeze) throw createAppError('CONFLICT', 'Transcript is frozen');
}
