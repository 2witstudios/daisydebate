import type { StagedFrame } from './capture-staging';
const MAX_FRAMES = 20;
const iso = (ms: number) => new Date(ms).toISOString();
/** Freshest staged frames per seat as relay bodies; the server adds the receipt. */
export function activityBatches(frames: readonly StagedFrame[]) {
  const seats = new Map<string, StagedFrame[]>();
  for (const frame of frames) {
    const seat = seats.get(frame.seat) ?? [];
    seat.push(frame);
    seats.set(frame.seat, seat);
  }
  return [...seats].map(([roundParticipantId, staged]) => ({
    roundParticipantId,
    frames: staged.slice(-MAX_FRAMES).map(({ frame, original }) => ({
      trackId: frame.trackId,
      sequence: original.sequence,
      pcm: Array.from(frame.pcm),
      beforeMs: original.beforeMs,
      afterMs: original.afterMs,
      serverWindow: { before: iso(frame.beforeMs), after: iso(frame.afterMs) },
    })),
  }));
}
