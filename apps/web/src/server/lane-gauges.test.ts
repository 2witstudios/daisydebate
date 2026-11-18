import { assert, setupRitewayBun, test } from 'riteway/bun';
import { startLaneGauges } from './lane-gauges';
import type { LaneWindowLine } from './lane-window';

setupRitewayBun();

const harness = () => {
  const lines: LaneWindowLine[] = [];
  let tick = () => {};
  const readings = [0, 2, 4];
  const gauges = startLaneGauges({
    gauges: () => [
      {
        lane: 'competitive' as const,
        connections: 10,
        active: readings.shift() ?? 0,
        waiting: 1,
      },
    ],
    drainHolds: () => [
      {
        lane: 'competitive' as const,
        total: { count: 2, totalMs: 44, maxMs: 40, p95Ms: 40, waits: 0 },
        operations: [
          {
            operation: 'claimMediaReconcile',
            count: 2,
            totalMs: 44,
            maxMs: 40,
            p95Ms: 40,
            waits: 0,
          },
        ],
      },
    ],
    log: (line) => lines.push(line),
    detail: false,
    samplesPerWindow: 3,
    every: (_ms, run) => {
      tick = run;
      return { stop: () => undefined };
    },
  });
  return { lines, tick: () => tick(), gauges };
};

test('lanes report one time-average window, not refusal-time samples', () => {
  const { lines, tick } = harness();
  tick();
  tick();
  assert({
    given: 'a window not yet full',
    should: 'log nothing',
    actual: lines,
    expected: [],
  });
  tick();
  assert({
    given: 'a full window with only quick holds',
    should: 'log one line for the lane with its occupancy and hold totals',
    actual: lines,
    expected: [
      {
        event: 'db.lane.window',
        fields: {
          lane: 'competitive',
          connections: 10,
          samples: 3,
          activeSum: 6,
          activeMax: 4,
          waitingSum: 3,
          waitingMax: 1,
          holds: 2,
          durationMs: 44,
          maxMs: 40,
          p95Ms: 40,
          waits: 0,
        },
      },
    ],
  });
  tick();
  assert({
    given: 'the next window just begun',
    should: 'start its counts again',
    actual: lines.length,
    expected: 1,
  });
});
