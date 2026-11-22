import { asc, eq, sql } from 'drizzle-orm';
import type { CaptureRule } from '@daisy/protocol/capture-verdict';
import { readSeatGrants } from './capture-history';
import { transcriptSegments } from './schema/transcript-segments';
import type { Tx } from './tx';
import { run } from './raw-rows';

export type ExpectedTranscriptStream = {
  readonly segmentId: string;
  readonly roundParticipantId: string;
};
export async function lockFinalizationStreams(
  tx: Tx,
  roundId: string,
  botGrantUnused: CaptureRule['botGrantUnused'],
) {
  // Takeover requests only lease, never Round afterward. Missing sessions need no lease.
  await run(
    tx,
    sql`select l.session_id from media_worker_leases l
    join media_sessions s on s.id=l.session_id where s.round_id=${roundId}
    order by l.session_id for update of l`,
  );
  const streams = await tx
    .select()
    .from(transcriptSegments)
    .where(eq(transcriptSegments.roundId, roundId))
    .orderBy(
      asc(transcriptSegments.segmentId),
      asc(transcriptSegments.roundParticipantId),
    )
    .for('update');
  // Discovery from actual history, never from seal rows or a predicted timetable.
  // A human owes a stream for every grant; a bot not for a grant it did not use.
  const expected: ExpectedTranscriptStream[] = (
    await readSeatGrants(tx, { roundId })
  )
    .filter(({ grant }) => !botGrantUnused(grant))
    .map(({ segmentId, roundParticipantId }) => ({
      segmentId,
      roundParticipantId,
    }));
  return { streams, expected };
}

export const streamKey = (stream: ExpectedTranscriptStream) =>
  `${stream.segmentId}:${stream.roundParticipantId}`;

export async function closeUnresolvedStreams(
  tx: Tx,
  roundId: string,
  facts: Awaited<ReturnType<typeof lockFinalizationStreams>>,
) {
  const present = new Set(facts.streams.map(streamKey));
  const missing = facts.expected.filter(
    (stream) => !present.has(streamKey(stream)),
  );
  if (missing.length > 0)
    await tx.insert(transcriptSegments).values(
      missing.map((stream) => ({
        ...stream,
        roundId,
        state: 'partial' as const,
        partialReasons: ['never-sealed' as const],
        chunkCount: 0,
        sealedChunkCount: 0,
        sealedAt: sql`clock_timestamp()`,
      })),
    );
  await tx
    .update(transcriptSegments)
    .set({
      state: 'partial',
      partialReasons: ['never-sealed'],
      sealedChunkCount: sql`${transcriptSegments.chunkCount}`,
      sealedAt: sql`clock_timestamp()`,
    })
    .where(
      sql`${transcriptSegments.roundId}=${roundId} and ${transcriptSegments.state}='open'`,
    );
}
