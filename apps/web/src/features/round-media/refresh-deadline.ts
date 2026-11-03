import type { RoundView } from '@daisy/protocol';
import { floorBoundaries, floorClockOf } from './floor-clock';

/** These deadlines request a server read; they never open a browser microphone. */
export function nextMediaRefreshAt(view: RoundView): number | null {
  const boundaries = floorBoundaries(floorClockOf(view));
  return boundaries.length ? Math.min(...boundaries) : null;
}
