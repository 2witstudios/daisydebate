import { asc, eq, sql } from 'drizzle-orm';
import type { BoundedTransactionContext } from './transaction-context';
import { transcriptSegments } from './schema/transcript-segments';

export type ExpectedTranscriptStream = {
  readonly segmentId: string;
  readonly roundParticipantId: string;
};
export async function lockFinalizationStreams(
  tx: BoundedTransactionContext,
  roundId: string,
) {
  // Takeover requests only lease, never Round afterward. Missing sessions need no lease.
  await tx.execute(sql`select l.session_id from media_worker_leases l
    join media_sessions s on s.id=l.session_id where s.round_id=${roundId}
    order by l.session_id for update of l`);
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
  const expected =
    (await tx.execute(sql`select distinct i.segment_id as "segmentId", i.round_participant_id as "roundParticipantId"
    from round_speaking_intervals i join round_participants p on p.id=i.round_participant_id and p.round_id=i.round_id
    join actors a on a.id=p.actor_id
    where i.round_id=${roundId} and p.role<>'judge' and (i.ended_at is null or i.ended_at>i.started_at)
    order by i.segment_id, i.round_participant_id`)) as unknown as ExpectedTranscriptStream[];
  return { streams, expected };
}

export const streamKey = (stream: ExpectedTranscriptStream) =>
  `${stream.segmentId}:${stream.roundParticipantId}`;

export async function closeUnresolvedStreams(
  tx: BoundedTransactionContext,
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
        chunkCount: 0,
        sealedChunkCount: 0,
        sealedAt: sql`clock_timestamp()`,
      })),
    );
  await tx
    .update(transcriptSegments)
    .set({
      state: 'partial',
      sealedChunkCount: sql`${transcriptSegments.chunkCount}`,
      sealedAt: sql`clock_timestamp()`,
    })
    .where(
      sql`${transcriptSegments.roundId}=${roundId} and ${transcriptSegments.state}='open'`,
    );
}
