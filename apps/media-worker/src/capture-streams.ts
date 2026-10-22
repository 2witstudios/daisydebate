import { createAppError } from '@daisy/errors';
import type { CaptureState } from './capture-history';

type Stream = {
  readonly segmentId: string;
  readonly roundParticipantId: string;
  count: number;
};
type Key = Pick<Stream, 'segmentId' | 'roundParticipantId'>;

/**
 * Bounded segment/seat streams this worker seals at shutdown. A committed
 * nonempty speaking interval is expected even when no clip arrives, so a
 * silent seat seals partial instead of leaving open coverage; the seal
 * predicate, not this tracker, decides completeness.
 */
export function createStreamTracker(ceiling: number) {
  const streams = new Map<string, Stream>();
  const forClip = (key: Key) => {
    const id = JSON.stringify([key.segmentId, key.roundParticipantId]);
    let stream = streams.get(id);
    if (!stream) {
      if (streams.size >= ceiling)
        throw createAppError(
          'INFRASTRUCTURE',
          'Capture stream capacity exceeded',
        );
      stream = { ...key, count: 0 };
      streams.set(id, stream);
    }
    return stream;
  };
  return {
    forClip,
    remember(state: CaptureState) {
      const segment = state.segment;
      if (!segment) return;
      for (const interval of state.intervals) {
        const end = Math.min(
          Date.parse(interval.endedAt ?? state.serverNow),
          Date.parse(segment.endedAt ?? state.serverNow),
          Date.parse(segment.startedAt) + segment.durationMs,
        );
        if (Date.parse(interval.startedAt) < end)
          forClip({
            segmentId: segment.id,
            roundParticipantId: interval.roundParticipantId,
          });
      }
    },
    values: () => streams.values(),
  };
}
