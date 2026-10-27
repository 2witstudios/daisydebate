import type { BotListenerClient } from '@daisy/media/bot-listener';
const MAX_FRAMES = 20;
/** Under the feed's 250 ms staleness and its 50 ms poll; a batch spans 200 ms. */
export const ACTIVITY_RELAY_INTERVAL_MS = 50;
const iso = (ms: number) => new Date(ms).toISOString();

/** One peer frame as the listener timed it: the seat, its segment, native brackets and server window. */
export type ListenerFrame = {
  readonly seat: string;
  readonly segmentId: string;
  readonly original: {
    readonly sequence: number;
    readonly beforeMs: number;
    readonly afterMs: number;
  };
  readonly frame: {
    readonly trackId: string;
    readonly pcm: Int16Array;
    readonly beforeMs: number;
    readonly afterMs: number;
  };
};
/** What the listener knows of the Round from its own read. */
export type ListenerState = {
  readonly segment: { readonly type: string } | null;
  readonly participants: readonly { readonly kind: string }[];
};
/** Peer activity has a consumer only while a bot may speak in cross-examination. */
export const activityWanted = (state: ListenerState) =>
  state.segment?.type === 'cross_ex' &&
  state.participants.some((p) => p.kind === 'bot');
/**
 * Per-seat sliding window of the newest staged frames. Each batch repeats the
 * window, so the consumer, which reads only the latest batch and skips frames
 * it already delivered, sees every frame while relays run faster than 200 ms.
 */
export function createActivityRelay() {
  const windows = new Map<string, ListenerFrame[]>();
  const fresh = new Set<string>();
  return {
    observe(frame: ListenerFrame) {
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
/** Heuristic only: a refused or lost batch is unknown activity, never a capture failure. */
export async function relayActivity(
  client: Pick<BotListenerClient, 'activity'>,
  epoch: number,
  batches: ReturnType<ReturnType<typeof createActivityRelay>['take']>,
  signal: AbortSignal,
) {
  const results = await Promise.allSettled(
    batches.map((batch) => client.activity({ epoch, ...batch }, signal)),
  );
  return results.filter((r) => r.status === 'fulfilled').length;
}
