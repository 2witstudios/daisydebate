import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { BoundedTransactionContext } from './transaction-context';
import type { BotPublicationScope } from './bot-publication-context';
import { roundSegments } from './schema/round-segments';
import { utterances } from './schema/utterances';

/**
 * Whether capture has written what a peer said up to `since`: a captured
 * line by one of `peers`, in the claim's own segment, whose clip ends at or
 * after that instant (the segment's start, plus the clip's offset and
 * length). A bot answers a peer's words only once they are in the
 * transcript; it reads them, and never writes or transcribes them.
 */
export async function peerLineReaches(
  tx: BoundedTransactionContext,
  scope: Pick<BotPublicationScope, 'roundId' | 'segmentId'>,
  peers: readonly string[],
  since: Date,
): Promise<boolean> {
  if (peers.length === 0) return false;
  const [line] = await tx
    .select({ id: utterances.id })
    .from(utterances)
    .innerJoin(
      roundSegments,
      and(
        eq(roundSegments.id, utterances.segmentId),
        eq(roundSegments.roundId, utterances.roundId),
      ),
    )
    .where(
      and(
        eq(utterances.roundId, scope.roundId),
        eq(utterances.segmentId, scope.segmentId),
        inArray(utterances.roundParticipantId, [...peers]),
        isNotNull(utterances.captureTrackId),
        sql`${roundSegments.startedAt} + (${utterances.captureStartOffsetMs} + ${utterances.captureDurationMs}) * interval '1 millisecond' >= ${since.toISOString()}::timestamptz`,
      ),
    )
    .limit(1);
  return line !== undefined;
}
