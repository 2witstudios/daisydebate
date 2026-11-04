import {
  partialReasonsStateLoss,
  type CaptureRule,
  type FrozenCapture,
} from '@daisy/protocol';
import { and, eq, ne, sql } from 'drizzle-orm';
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
  const closed = await tx
    .select({
      segmentId: transcriptSegments.segmentId,
      roundParticipantId: transcriptSegments.roundParticipantId,
      state: transcriptSegments.state,
      partialReasons: transcriptSegments.partialReasons,
    })
    .from(transcriptSegments)
    .where(
      and(
        eq(transcriptSegments.roundId, roundId),
        ne(transcriptSegments.state, 'open'),
      ),
    );
  const partial = closed.filter((stream) => stream.state === 'partial');
  // A coverage gap alone can be a silent seat, never the platform's failure to state. A
  // takeover's gap is the platform's: a worker died there.
  const lost = partial.filter(
    (stream) =>
      partialReasonsStateLoss(stream.partialReasons) ||
      stream.partialReasons.includes('other-worker-evidence'),
  );
  const found = await closedStreamGaps(tx, roundId, closed, rule);
  const isLost = (stream: (typeof closed)[number]) => lost.includes(stream);
  /** Every gap capture can measure, for the transcript and the judge. */
  const stated = closed.flatMap((stream) =>
    (found.get(streamKey(stream)) ?? []).map(({ edge, ...gap }) => ({
      segmentId: stream.segmentId,
      roundParticipantId: stream.roundParticipantId,
      ...gap,
      cause: edge
        ? ('edge' as const)
        : isLost(stream)
          ? ('platform' as const)
          : ('unattributed' as const),
    })),
  );
  // Zero gaps over valid windows measures zero. Only history with no windows has no measure.
  const unmeasured = (stream: (typeof partial)[number]) =>
    stream.partialReasons.some(
      (reason) =>
        reason === 'invalid-history' || reason === 'no-authority-window',
    );
  // Edges decide nothing, or a Round of short speeches would lose its judge to them.
  const sum = (of: typeof partial) =>
    of
      .flatMap((stream) => found.get(streamKey(stream)) ?? [])
      .filter(({ edge }) => !edge)
      .reduce((total, gap) => total + gap.untilOffsetMs - gap.fromOffsetMs, 0);
  const frozenCapture = (): FrozenCapture => {
    const expectedMs = expectedSpeechMs;
    if (lost.some(unmeasured))
      return { kind: 'platform-unmeasured', expectedMs };
    return partial.some(unmeasured)
      ? {
          kind: 'unheard-unmeasured',
          platformLostMs: sum(lost),
          expectedMs,
        }
      : {
          kind: 'measured',
          unheardMs: sum(partial),
          platformLostMs: sum(lost),
          expectedMs,
        };
  };
  return {
    captureGaps: { gaps: stated },
    capture: frozenCapture(),
  };
}
