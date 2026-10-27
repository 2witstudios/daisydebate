import { createCaptureClock } from '@daisy/media/observation';

type Calibration = Parameters<typeof createCaptureClock>[0];
type Observation = Parameters<
  ReturnType<typeof createCaptureClock>['observe']
>[0];

/**
 * One server-time clock per native track (DEC-215), as every media worker
 * role times frames: a track's first frame starts its clock on the current
 * calibration, refreshes reach every clock, and a closed track's clock goes.
 * Each window is rounded outward to whole milliseconds.
 */
export function createTrackClocks() {
  const clocks = new Map<string, ReturnType<typeof createCaptureClock>>();
  return {
    observe(
      frame: Observation & { readonly trackId: string },
      calibration: Calibration,
    ) {
      let clock = clocks.get(frame.trackId);
      if (!clock) {
        clock = createCaptureClock(calibration);
        clocks.set(frame.trackId, clock);
      }
      const window = clock.observe(frame);
      return window
        ? {
            beforeMs: Math.floor(window.beforeMs),
            afterMs: Math.ceil(window.afterMs),
            nominalStartMs: window.nominalStartMs,
          }
        : null;
    },
    refresh(calibration: Calibration) {
      for (const clock of clocks.values()) clock.refresh(calibration);
    },
    close(trackId: string) {
      clocks.delete(trackId);
    },
    clear() {
      clocks.clear();
    },
  };
}
