import {
  partialReasonsStateLoss,
  speakingEndMs,
  type CaptureRule,
} from '@daisy/protocol';
import { and, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { closedStreamGaps, streamKey } from './capture-gaps';
import { roundSegments } from './schema/round-segments';
import { transcriptSegments } from './schema/transcript-segments';

type Reader = Pick<BunSQLDatabase, 'select'>;

/** How much speech a Round owed and lost, read once its streams have closed. */
export async function readCaptureShortfall(
  tx: Reader,
  roundId: string,
  rule: CaptureRule,
) {
  const segments = await tx
    .select()
    .from(roundSegments)
    .where(eq(roundSegments.roundId, roundId));
  const expectedSpeechMs = segments.reduce((total, segment) => {
    const startedAtMs = segment.startedAt.getTime();
    return (
      total +
      speakingEndMs({
        startedAtMs,
        endedAtMs: segment.endedAt?.getTime() ?? null,
        durationMs: segment.durationMs,
        returnedMs: segment.returnedMs,
      }) -
      startedAtMs
    );
  }, 0);
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
  const found = await closedStreamGaps(tx, roundId, partial, rule);
  const gaps = partial.flatMap((stream) =>
    (found.get(streamKey(stream)) ?? []).map((gap) => ({
      segmentId: stream.segmentId,
      roundParticipantId: stream.roundParticipantId,
      ...gap,
    })),
  );
  const unmeasured = partial.some(
    (stream) => (found.get(streamKey(stream)) ?? []).length === 0,
  );
  return {
    platformLostAudio: partial.some((stream) =>
      partialReasonsStateLoss(stream.partialReasons),
    ),
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
