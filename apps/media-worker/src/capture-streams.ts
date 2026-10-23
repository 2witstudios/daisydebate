import { createAppError } from '@daisy/errors';
import {
  CAPTURE_BATCH_INTERVAL_MS,
  STAGED_FRAME_MAX_AGE_MS,
} from './capture-batch';
import type { CaptureState } from './capture-history';

type Stream = {
  readonly segmentId: string;
  readonly roundParticipantId: string;
  count: number;
  /** Clips cut for this stream and not yet transcribed, refused or dropped. */
  pending: number;
  /** When its segment was known to have ended, in server time. */
  endedAtMs: number | null;
  /** Sealed, or definitely refused: never offered for sealing again. */
  finished: boolean;
};
type Key = Pick<Stream, 'segmentId' | 'roundParticipantId'>;

/**
 * After a segment ends, every one of its staged frames is cut into a clip or
 * dropped within this window: no frame outlives the staging age bound, and the
 * batch loop runs once per interval.
 */
const SEAL_SETTLE_MS = STAGED_FRAME_MAX_AGE_MS + CAPTURE_BATCH_INTERVAL_MS;

/**
 * Bounded segment/seat streams this worker seals. A committed nonempty
 * speaking interval is expected even when no clip arrives, so a silent seat
 * seals with zero chunks instead of leaving open coverage; the server's seal
 * predicate, not this tracker, decides completeness. A stream is due once its
 * segment has ended, the settle window has passed and none of its clips is in
 * flight, so it seals before the admission cutoff (VIDEO-4.1); shutdown seals
 * whatever is left.
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
      stream = {
        ...key,
        count: 0,
        pending: 0,
        endedAtMs: null,
        finished: false,
      };
      streams.set(id, stream);
    }
    return stream;
  };
  return {
    forClip,
    remember(state: CaptureState) {
      markEnded(streams.values(), state);
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
      markEnded(streams.values(), state);
    },
    queued(key: Key) {
      forClip(key).pending++;
    },
    settled(key: Key) {
      forClip(key).pending--;
    },
    finished(key: Key) {
      forClip(key).finished = true;
    },
    /** Streams ready to seal at this server time. */
    due: (serverNowMs: number) =>
      [...streams.values()].filter(
        (stream) =>
          !stream.finished &&
          stream.pending === 0 &&
          stream.endedAtMs !== null &&
          serverNowMs - stream.endedAtMs >= SEAL_SETTLE_MS,
      ),
    values: () => streams.values(),
  };
}

/**
 * A stream's segment ended at its recorded end, or, once the history has moved
 * past it, no later than the server time it was first seen superseded.
 */
function markEnded(streams: Iterable<Stream>, state: CaptureState) {
  const segment = state.segment;
  for (const stream of streams) {
    if (stream.endedAtMs !== null) continue;
    if (stream.segmentId !== segment?.id)
      stream.endedAtMs = Date.parse(state.serverNow);
    else if (segment.endedAt !== null)
      stream.endedAtMs = Date.parse(segment.endedAt);
  }
}
