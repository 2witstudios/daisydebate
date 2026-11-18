import type { Database } from '@daisy/db';
import {
  laneWindowLines,
  sampled,
  type LaneOccupancy,
  type LaneWindowLine,
} from './lane-window';

type Gauge = ReturnType<Database['laneGauges']>[number];
/** Fine enough for a time average; a lane read is two integers. */
const SAMPLE_MS = 250;
/** One window a minute: an idle process writes one line per lane per minute. */
const SAMPLES_PER_WINDOW = 240;

/**
 * Each lane's occupancy as a continuous time average, and how long its
 * operations held it (FLOOR-2), as one line per lane per window. No Round or
 * person appears: lane names and operation names only.
 */
export function startLaneGauges(input: {
  readonly gauges: () => readonly Gauge[];
  readonly drainHolds: Database['drainLaneHolds'];
  readonly log: (line: LaneWindowLine) => void;
  readonly every: (
    ms: number,
    run: () => void,
  ) => { readonly stop: () => void };
  /** Every operation's holds each window, not only slow ones (LOG_LEVEL debug). */
  readonly detail: boolean;
  readonly samplesPerWindow?: number;
}) {
  const size = input.samplesPerWindow ?? SAMPLES_PER_WINDOW;
  let occupancy = new Map<string, LaneOccupancy>();
  let samples = 0;
  const flush = () => {
    for (const line of laneWindowLines({
      occupancy,
      holds: input.drainHolds(),
      detail: input.detail,
    }))
      input.log(line);
    occupancy = new Map();
    samples = 0;
  };
  const timer = input.every(SAMPLE_MS, () => {
    for (const gauge of input.gauges())
      occupancy.set(gauge.lane, sampled(occupancy.get(gauge.lane), gauge));
    samples += 1;
    if (samples >= size) flush();
  });
  return {
    /** Stops sampling and logs the window in progress: a shutdown keeps its evidence. */
    stop() {
      timer.stop();
      if (samples > 0) flush();
    },
  };
}
