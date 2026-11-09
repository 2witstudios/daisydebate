import { and, asc, eq, isNotNull, lte, or, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { roundSegments } from './schema/round-segments';
import { utterances } from './schema/utterances';

/**
 * Lines that have been said by now: a bot's line written ahead of its audio
 * (ADR 0122) is dated by when that audio starts, and stays unread until then.
 */
export const utteranceStarted = lte(
  utterances.createdAt,
  sql`clock_timestamp()`,
);
/**
 * Shared evidence ordering; callers supply either an existing freeze or
 * fresh generation fences. `live` reads every line said so far; `spoken`
 * reads only lines someone said, captured from a microphone or authored by
 * a bot as it played; `frozen` reads a freeze, which holds only said lines.
 */
export function readOrderedRoundUtterances(
  reader: Pick<BunSQLDatabase, 'select'>,
  roundId: string,
  source: 'frozen' | 'live' | 'spoken',
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
        source === 'frozen' ? undefined : utteranceStarted,
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
