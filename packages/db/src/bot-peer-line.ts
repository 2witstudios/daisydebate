import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import type { BoundedTransactionContext } from './transaction-context';
import type { BotPublicationScope } from './bot-publication-context';
import { roundSegments } from './schema/round-segments';
import { utterances } from './schema/utterances';

/**
 * Whether what a peer said up to `since` is in the transcript, as a line a
 * bot's answer may build on (`readOrderedRoundUtterances` 'spoken'): a
 * person's captured line whose clip ends at or after that instant (the
 * segment's start, plus the clip's offset and length), or a bot peer's
 * authored line, closed, whose audio does. A bot answers a peer's words only
 * once they are in the transcript; it reads them, and never writes or
 * transcribes them.
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
        or(
          and(
            isNotNull(utterances.captureTrackId),
            sql`${roundSegments.startedAt} + (${utterances.captureStartOffsetMs} + ${utterances.captureDurationMs}) * interval '1 millisecond' >= ${since.toISOString()}::timestamptz`,
          ),
          // An authored line is dated at its audio start, and is history once closed.
          and(
            isNotNull(utterances.botPhraseId),
            eq(utterances.complete, true),
            sql`${utterances.createdAt} + ${utterances.botDurationMs} * interval '1 millisecond' >= ${since.toISOString()}::timestamptz`,
          ),
        ),
      ),
    )
    .limit(1);
  return line !== undefined;
}
