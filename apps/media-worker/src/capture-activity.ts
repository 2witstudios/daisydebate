import type { CaptureState } from './capture-history';
import type { StagedFrame } from './capture-staging';
const MAX_FRAMES = 20;
/** Under the feed's 250 ms staleness and its 50 ms poll; a batch spans 200 ms. */
export const ACTIVITY_RELAY_INTERVAL_MS = 50;
const iso = (ms: number) => new Date(ms).toISOString();
/** Peer activity has a consumer only while a bot may speak in cross-examination. */
export const activityWanted = (state: CaptureState) =>
  state.segment?.type === 'cross_ex' &&
  state.participants.some((p) => p.kind === 'bot');
/**
 * Per-seat sliding window of the newest staged frames. Each batch repeats the
 * window, so the consumer, which reads only the latest batch and skips frames
 * it already delivered, sees every frame while relays run faster than 200 ms.
 */
export function createActivityRelay() {
  const windows = new Map<string, StagedFrame[]>();
  const fresh = new Set<string>();
  return {
    observe(frame: StagedFrame) {
      const held = windows.get(frame.seat) ?? [];
      // A window never spans segments: the batch names one phase.
      const window = held[0]?.segmentId === frame.segmentId ? held : [];
      window.push(frame);
      if (window.length > MAX_FRAMES) window.shift();
      windows.set(frame.seat, window);
      fresh.add(frame.seat);
    },
    /** Batches for seats with frames since the last take; the server adds the receipt. */
    take() {
      const seats = [...fresh];
      fresh.clear();
      return seats.map((roundParticipantId) => {
        const window = windows.get(roundParticipantId)!;
        return {
          roundParticipantId,
          segmentId: window[0]!.segmentId,
          frames: window.map(({ frame, original }) => ({
            trackId: frame.trackId,
            sequence: original.sequence,
            pcm: Array.from(frame.pcm),
            beforeMs: original.beforeMs,
            afterMs: original.afterMs,
            serverWindow: {
              before: iso(frame.beforeMs),
              after: iso(frame.afterMs),
            },
          })),
        };
      });
    },
    clear() {
      windows.clear();
      fresh.clear();
    },
  };
}
