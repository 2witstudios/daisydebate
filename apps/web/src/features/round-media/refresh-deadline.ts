import type { RoundView } from '@daisy/protocol';
import { floorBoundaries, type FloorClock } from './floor-clock';

const viewClock = (view: RoundView): FloorClock => {
  const prep = view.checkpoint?.active_prep;
  return {
    startedAt: view.startedAt,
    countdownMs: view.rules.countdownMs,
    segmentTotal: view.rules.segments.length,
    prepBudgetMs: view.rules.inRoundPrep?.budgetMsPerSide ?? null,
    activePrep: prep
      ? {
          startedAt: prep.started_at,
          consumedMs: view.checkpoint!.prep_consumed_ms[prep.side],
        }
      : null,
    segmentCount: view.segments.length,
    lastSegment: view.segments.at(-1) ?? null,
  };
};
/** These deadlines request a server read; they never open a browser microphone. */
export function nextMediaRefreshAt(view: RoundView): number | null {
  const boundaries = floorBoundaries(viewClock(view));
  return boundaries.length ? Math.min(...boundaries) : null;
}
