import { createAppError } from '@daisy/errors';
import { speakingEndMs } from '@daisy/protocol';
import { CAPTURE_BATCH_INTERVAL_MS } from './capture-batch';
import type { CaptureState } from './capture-history';

type Stream = {
  readonly segmentId: string;
  readonly roundParticipantId: string;
  count: number;
  /** Clips cut for this stream and not yet transcribed, refused or dropped. */
  pending: number;
  /** When its segment was known to have ended, in server time. */
  endedAtMs: number | null;
  /** This process held frames of this stream and lost them. */
  framesLost: boolean;
  /** Sealed, or definitely refused: never offered for sealing again. */
  finished: boolean;
};
type Key = Pick<Stream, 'segmentId' | 'roundParticipantId'>;

/**
 * After a segment ends, its last frames still arriving from LiveKit reach
 * staging within this window; a stream also waits for staging to hand over
 * every frame it holds (ISSUE-577).
 */
/** LiveKit keeps a segment's last frames in flight for about this long. */
const FRAME_ARRIVAL_MS = 500;
/** One batch interval on top of the frame-arrival allowance. */
const SEAL_SETTLE_MS = FRAME_ARRIVAL_MS + CAPTURE_BATCH_INTERVAL_MS;

/** Each history's bot seats and identities, built once: frames ask per 10 ms. */
const botsOf = new WeakMap<
  CaptureState,
  {
    readonly seats: ReadonlySet<string>;
    readonly identities: ReadonlySet<string>;
  }
>();
const bots = (state: CaptureState) => {
  let known = botsOf.get(state);
  if (!known) {
    const seated = state.participants.filter((p) => p.kind === 'bot');
    known = {
      seats: new Set(seated.map((p) => p.roundParticipantId)),
      identities: new Set(
        seated.flatMap((p) => (p.identity ? [p.identity] : [])),
      ),
    };
    botsOf.set(state, known);
  }
  return known;
};
/** A track identity that is a bot's seat: its frames are never staged. */
export const botIdentity = (state: CaptureState, identity: string) =>
  bots(state).identities.has(identity);
/** Whether a seat is a bot's, whose transcript is authored, never captured (ADR 0122). */
export const botSeat = (state: CaptureState, roundParticipantId: string) =>
  bots(state).seats.has(roundParticipantId);

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
        framesLost: false,
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
          speakingEndMs({
            startedAtMs: Date.parse(segment.startedAt),
            endedAtMs: Date.parse(segment.endedAt ?? state.serverNow),
            durationMs: segment.durationMs,
            returnedMs: segment.returnedMs,
          }),
        );
        // A bot owes capture no stream: its transcript is authored (ADR 0122).
        if (
          Date.parse(interval.startedAt) < end &&
          !botSeat(state, interval.roundParticipantId)
        )
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
    lost(key: Key) {
      forClip(key).framesLost = true;
    },
    finished(key: Key) {
      forClip(key).finished = true;
    },
    /** Streams ready to seal at this server time, none of whose frames `staged` still holds. */
    due: (serverNowMs: number, staged: (stream: Key) => boolean) =>
      [...streams.values()].filter(
        (stream) =>
          !stream.finished &&
          stream.pending === 0 &&
          !staged(stream) &&
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
