import type { RoundView } from '@daisy/protocol';
import { floorBoundaries, floorClockOf } from './floor-clock';

/** These deadlines request a server read; they never open a browser microphone. */
export function nextMediaRefreshAt(
  view: RoundView,
  nowMs: number,
): number | null {
  const boundaries = floorBoundaries(floorClockOf(view));
  const ahead = boundaries.filter((at) => at > nowMs);
  if (ahead.length) return Math.min(...ahead);
  return boundaries.length ? Math.max(...boundaries) : null;
}
