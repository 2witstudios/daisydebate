import type { Database } from '@daisy/db';

type Gauge = ReturnType<Database['laneGauges']>[number];
type Hold = ReturnType<Database['drainLaneHolds']>[number];
type Window = {
  connections: number;
  samples: number;
  activeSum: number;
  activeMax: number;
  waitingSum: number;
  waitingMax: number;
};
/** Fine enough for a time average; a lane read is two integers. */
const SAMPLE_MS = 250;
const SAMPLES_PER_WINDOW = 20;

const added = (window: Window | undefined, gauge: Gauge): Window => ({
  connections: gauge.connections,
  samples: (window?.samples ?? 0) + 1,
  activeSum: (window?.activeSum ?? 0) + gauge.active,
  activeMax: Math.max(window?.activeMax ?? 0, gauge.active),
  waitingSum: (window?.waitingSum ?? 0) + gauge.waiting,
  waitingMax: Math.max(window?.waitingMax ?? 0, gauge.waiting),
});

/**
 * Each lane's occupancy as a continuous time average, and how long each
 * operation held it (FLOOR-2). No Round or person appears: lane names and
 * operation names only.
 */
export function startLaneGauges(input: {
  readonly gauges: () => readonly Gauge[];
  readonly drainHolds: () => readonly Hold[];
  readonly log: (
    event: 'db.lane.gauge' | 'db.lane.hold',
    fields: Record<string, string | number>,
  ) => void;
  readonly every: (
    ms: number,
    run: () => void,
  ) => { readonly stop: () => void };
  readonly samplesPerWindow?: number;
}) {
  const size = input.samplesPerWindow ?? SAMPLES_PER_WINDOW;
  let windows = new Map<string, Window>();
  let sampled = 0;
  return input.every(SAMPLE_MS, () => {
    for (const gauge of input.gauges())
      windows.set(gauge.lane, added(windows.get(gauge.lane), gauge));
    sampled += 1;
    if (sampled < size) return;
    for (const [lane, window] of windows)
      input.log('db.lane.gauge', { lane, ...window });
    for (const {
      lane,
      operation,
      count,
      totalMs,
      maxMs,
      p95Ms,
    } of input.drainHolds())
      input.log('db.lane.hold', {
        lane,
        operation,
        holds: count,
        durationMs: totalMs,
        maxMs,
        p95Ms,
      });
    windows = new Map();
    sampled = 0;
  });
}
