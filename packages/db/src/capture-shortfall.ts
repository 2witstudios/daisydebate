import { partialReasonsStateLoss, type CaptureRule } from '@daisy/protocol';
import { and, eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { closedStreamGaps, streamKey } from './capture-gaps';
import { roundSpeakingIntervals } from './schema/round-speaking-intervals';
import { transcriptSegments } from './schema/transcript-segments';

type Reader = Pick<BunSQLDatabase, 'select'>;

/** How much speech a Round owed and lost, read once its streams have closed. */
export async function readCaptureShortfall(
  tx: Reader,
  roundId: string,
  rule: CaptureRule,
) {
  const [spoken] = await tx
    .select({
      ms: sql<number>`coalesce(sum(extract(epoch from ${roundSpeakingIntervals.endedAt} - ${roundSpeakingIntervals.startedAt})), 0)::float8 * 1000`,
    })
    .from(roundSpeakingIntervals)
    .where(eq(roundSpeakingIntervals.roundId, roundId));
  // What each stream was owed: a hold gives nobody anything to say, and cross-examination
  // owes each speaker their own stream, as the gaps below are counted.
  const expectedSpeechMs = Math.round(spoken?.ms ?? 0);
  const partial = await tx
    .select({
      segmentId: transcriptSegments.segmentId,
      roundParticipantId: transcriptSegments.roundParticipantId,
      partialReasons: transcriptSegments.partialReasons,
    })
    .from(transcriptSegments)
    .where(
      and(
        eq(transcriptSegments.roundId, roundId),
        eq(transcriptSegments.state, 'partial'),
      ),
    );
  // A coverage gap alone can be a silent seat, never the platform's failure to state.
  const lost = partial.filter((stream) =>
    partialReasonsStateLoss(stream.partialReasons),
  );
  const found = await closedStreamGaps(tx, roundId, lost, rule);
  const gaps = lost.flatMap((stream) =>
    (found.get(streamKey(stream)) ?? []).map((gap) => ({
      segmentId: stream.segmentId,
      roundParticipantId: stream.roundParticipantId,
      ...gap,
    })),
  );
  // Zero gaps over valid windows measures zero. Only history with no windows has no measure.
  const unmeasured = partial.some((stream) =>
    stream.partialReasons.some(
      (reason) =>
        reason === 'invalid-history' || reason === 'no-authority-window',
    ),
  );
  return {
    platformLostAudio: lost.length > 0,
    expectedSpeechMs,
    captureGaps: { gaps },
    captureGapMs: unmeasured
      ? null
      : gaps.reduce(
          (total, gap) => total + gap.untilOffsetMs - gap.fromOffsetMs,
          0,
        ),
  };
}
