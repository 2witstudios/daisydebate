import { and, asc, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { roundTranscriptFreezes } from './schema/round-transcript-freezes';
import { transcriptSegments } from './schema/transcript-segments';
import { roundSegments } from './schema/round-segments';
import { utterances } from './schema/utterances';

type Reader = Pick<BunSQLDatabase, 'select'>;
export const readTranscriptFreeze = async (reader: Reader, roundId: string) => {
  const [row] = await reader
    .select()
    .from(roundTranscriptFreezes)
    .where(eq(roundTranscriptFreezes.roundId, roundId));
  return row ? { ...row, frozenAt: row.frozenAt.toISOString() } : null;
};

/** Reuses the caller's existing Round lock/transaction; never starts a transaction. */
export async function readLockedFrozenRoundTranscript(
  reader: Reader,
  roundId: string,
) {
  const freeze = await readTranscriptFreeze(reader, roundId);
  if (!freeze) return null;
  const coverage = await reader
    .select({
      segmentId: transcriptSegments.segmentId,
      roundParticipantId: transcriptSegments.roundParticipantId,
      state: transcriptSegments.state,
      chunkCount: transcriptSegments.chunkCount,
      sealedChunkCount: transcriptSegments.sealedChunkCount,
      sealedAt: transcriptSegments.sealedAt,
    })
    .from(transcriptSegments)
    .innerJoin(
      roundSegments,
      and(
        eq(roundSegments.id, transcriptSegments.segmentId),
        eq(roundSegments.roundId, transcriptSegments.roundId),
      ),
    )
    .where(eq(transcriptSegments.roundId, roundId))
    .orderBy(
      asc(roundSegments.sequence),
      asc(transcriptSegments.roundParticipantId),
    );
  if (coverage.some((stream) => stream.state === 'open'))
    throw createAppError(
      'INVARIANT',
      'Frozen transcript has unresolved coverage',
    );
  const lines = await reader
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
    .where(eq(utterances.roundId, roundId))
    .orderBy(
      asc(roundSegments.sequence),
      asc(utterances.sequence),
      asc(utterances.id),
    );
  return {
    ...freeze,
    coverage: coverage.map((stream) => ({
      ...stream,
      sealedAt: stream.sealedAt?.toISOString() ?? null,
    })),
    utterances: lines,
  };
}
export type FrozenRoundTranscript = NonNullable<
  Awaited<ReturnType<typeof readLockedFrozenRoundTranscript>>
>;
