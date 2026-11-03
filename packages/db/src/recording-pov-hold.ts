import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { recordingPovCaptures as povs } from './schema/recording-pov-captures';
import type { BoundedTransactionContext } from './transaction-context';

/**
 * Whether a debater's POV Egress may still be subscribed to this Round. Like an
 * observer, it holds private conversation and cameras, with no timer: an unconfirmed
 * revocation stops the Egress, and revoking one that has gone then confirms.
 */
export const readPovSubscribed = async (
  tx: BoundedTransactionContext,
  input: { readonly roundId: string },
): Promise<boolean> => {
  const [pov] = await tx
    .select({ id: povs.recordingId })
    .from(povs)
    .where(
      and(
        eq(povs.roundId, input.roundId),
        isNotNull(povs.egressId),
        isNull(povs.endedAt),
        isNull(povs.observerRevokedAt),
      ),
    )
    .limit(1);
  return pov !== undefined;
};
