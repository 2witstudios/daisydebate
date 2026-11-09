import { and, asc, eq, isNotNull, or } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { roundSegments } from './schema/round-segments';
import { utterances } from './schema/utterances';

/**
 * Shared evidence ordering; callers supply either an existing freeze or
 * fresh generation fences. `spoken` reads only lines someone said: captured
 * from a microphone, or authored by a bot as it played (ADR 0122).
 */
export function readOrderedRoundUtterances(
  reader: Pick<BunSQLDatabase, 'select'>,
  roundId: string,
  source: 'frozen' | 'spoken',
) {
  return reader
    .select({
      id: utterances.id,
      segmentId: utterances.segmentId,
      segmentSequence: roundSegments.sequence,
      sequence: utterances.sequence,
      startOffsetMs: utterances.captureStartOffsetMs,
      roundParticipantId: utterances.roundParticipantId,
      text: utterances.text,
      complete: utterances.complete,
      interrupted: utterances.interrupted,
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
        source === 'spoken'
          ? or(
              isNotNull(utterances.captureTrackId),
              isNotNull(utterances.botPhraseId),
            )
          : undefined,
      ),
    )
    .orderBy(
      asc(roundSegments.sequence),
      asc(utterances.sequence),
      asc(utterances.id),
    );
}
