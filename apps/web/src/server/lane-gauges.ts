import { type DatabaseResources } from '@daisy/db/resources';
import type { Waits } from '@daisy/clock';
import { repeatEvery } from '@daisy/worker';
import {
  laneWindowLines,
  sampled,
  type LaneOccupancy,
  type LaneWindowLine,
} from './lane-window';

type Gauge = ReturnType<DatabaseResources['laneGauges']>[number];
/** Fine enough for a time average; a lane read is two integers. */
const SAMPLE_MS = 250;
/** One window a minute: an idle process writes one line per lane per minute. */
const SAMPLES_PER_WINDOW = 240;
/** At debug (the floor run), five-second windows: a short stall stays visible. */
const DETAIL_SAMPLES_PER_WINDOW = 20;

/**
 * Each lane's occupancy as a continuous time average, and how long its
 * operations held it (FLOOR-2), as one line per lane per window. No Round or
 * person appears: lane names and operation names only.
 */
export function startLaneGauges(input: {
  readonly gauges: () => readonly Gauge[];
  readonly drainHolds: DatabaseResources['drainLaneHolds'];
  readonly log: (line: LaneWindowLine) => void;
  readonly waits: Waits;
  /** Every operation's holds each window, not only slow ones (LOG_LEVEL debug). */
  readonly detail: boolean;
  readonly samplesPerWindow?: number;
}) {
  const size =
    input.samplesPerWindow ??
    (input.detail ? DETAIL_SAMPLES_PER_WINDOW : SAMPLES_PER_WINDOW);
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
  const sampling = repeatEvery({
    waits: input.waits,
    everyMs: SAMPLE_MS,
    run: async () => {
      for (const gauge of input.gauges())
        occupancy.set(gauge.lane, sampled(occupancy.get(gauge.lane), gauge));
      samples += 1;
      if (samples >= size) flush();
    },
    // A gauge read is two integers in memory; nothing here fails.
    failed: () => undefined,
  });
  return {
    /** Stops sampling and logs the window in progress: a shutdown keeps its evidence. */
    async stop() {
      await sampling.stop();
      if (samples > 0) flush();
    },
  };
}
