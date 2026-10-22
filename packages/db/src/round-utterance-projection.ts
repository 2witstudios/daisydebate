import { and, asc, eq, isNotNull } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { roundSegments } from './schema/round-segments';
import { utterances } from './schema/utterances';

/** Shared evidence ordering; callers supply either an existing freeze or fresh generation fences. */
export function readOrderedRoundUtterances(
  reader: Pick<BunSQLDatabase, 'select'>,
  roundId: string,
  source: 'frozen' | 'captured',
) {
  return reader
    .select({
      id: utterances.id,
      segmentId: utterances.segmentId,
      segmentSequence: roundSegments.sequence,
      sequence: utterances.sequence,
      roundParticipantId: utterances.roundParticipantId,
      text: utterances.text,
      complete: utterances.complete,
    })
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
        eq(utterances.roundId, roundId),
        source === 'captured'
          ? isNotNull(utterances.captureTrackId)
          : undefined,
      ),
    )
    .orderBy(
      asc(roundSegments.sequence),
      asc(utterances.sequence),
      asc(utterances.id),
    );
}
