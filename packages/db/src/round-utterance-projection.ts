import { and, asc, eq, isNotNull, or } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { roundSegments } from './schema/round-segments';
import { utterances } from './schema/utterances';

/**
 * Shared evidence ordering; callers supply either an existing freeze or
 * fresh generation fences. Every line was said: a bot's is written only as
 * its audio starts (ADR 0122). `spoken` reads the lines a bot's next answer
 * may build on: captured ones, and a bot's once closed.
 */
export function readOrderedRoundUtterances(
  reader: Pick<BunSQLDatabase, 'select'>,
  roundId: string,
  source: 'all' | 'spoken',
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
        // A bot line is history once it closed: while it plays, its words
        // are not all said yet, and may be cut.
        source === 'spoken'
          ? or(
              isNotNull(utterances.captureTrackId),
              and(
                isNotNull(utterances.botPhraseId),
                eq(utterances.complete, true),
              ),
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
