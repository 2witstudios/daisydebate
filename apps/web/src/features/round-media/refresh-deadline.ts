import type { RoundView } from '@daisy/protocol';
import { postRoundCallEndsAtMs } from '../post-round-call/offered';
import { floorBoundaries, floorClockOf } from './floor-clock';

/** These deadlines request a server read; they never open a browser microphone. */
export function nextMediaRefreshAt(
  view: RoundView,
  nowMs: number,
): number | null {
  // A post-round call has one boundary left: its own cap.
  const callEndsAtMs = postRoundCallEndsAtMs(view);
  if (callEndsAtMs !== null) return callEndsAtMs;
  const boundaries = floorBoundaries(floorClockOf(view));
  const ahead = boundaries.filter((at) => at > nowMs);
  if (ahead.length) return Math.min(...ahead);
  return boundaries.length ? Math.max(...boundaries) : null;
}
