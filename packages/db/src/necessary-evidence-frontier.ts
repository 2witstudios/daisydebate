import { eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { CaptureTx } from './media-capture-context';
import { roundTranscriptFreezes } from './schema/round-transcript-freezes';
/** Read-only competitive frontier fact; caller already owns the evidence Round fence. */
export async function requireEvidenceFrontierOpen(
  tx: CaptureTx,
  roundId: string,
) {
  const [freeze] = await tx
    .select({ id: roundTranscriptFreezes.roundId })
    .from(roundTranscriptFreezes)
    .where(eq(roundTranscriptFreezes.roundId, roundId));
  if (freeze) throw createAppError('CONFLICT', 'Evidence frontier is frozen');
}
