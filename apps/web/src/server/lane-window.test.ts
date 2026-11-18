import { assert, setupRitewayBun, test } from 'riteway/bun';
import { laneWindowLines, sampled, type LaneHolds } from './lane-window';

setupRitewayBun();

const quiet = sampled(undefined, {
  lane: 'browse',
  connections: 4,
  active: 0,
  waiting: 0,
});
const busy = sampled(
  sampled(undefined, {
    lane: 'competitive',
    connections: 10,
    active: 2,
    waiting: 0,
  }),
  { lane: 'competitive', connections: 10, active: 6, waiting: 3 },
);
const competitiveHolds: LaneHolds = {
  lane: 'competitive',
  total: { count: 42, totalMs: 1_903, maxMs: 1_200, p95Ms: 50, waits: 1 },
  operations: [
    {
      operation: 'claimJudging',
      count: 40,
      totalMs: 700,
      maxMs: 40,
      p95Ms: 25,
      waits: 0,
    },
    {
      operation: 'scanBilling',
      count: 1,
      totalMs: 1_200,
      maxMs: 1_200,
      p95Ms: 1_200,
      waits: 0,
    },
    {
      operation: 'readQueued',
      count: 1,
      totalMs: 3,
      maxMs: 3,
      p95Ms: 3,
      waits: 1,
    },
  ],
};
const occupancy = new Map([
  ['competitive', busy],
  ['browse', quiet],
]);

test('sampling a lane sums and maxes its readings', () => {
  assert({
    given: 'two readings of a lane',
    should: 'count them and keep sums and maxima',
    actual: busy,
    expected: {
      connections: 10,
      samples: 2,
      activeSum: 8,
      activeMax: 6,
      waitingSum: 3,
      waitingMax: 3,
    },
  });
});

test('a window is one line per lane plus only its slow or queued operations', () => {
  const lines = laneWindowLines({
    occupancy,
    holds: [competitiveHolds],
    detail: false,
  });
  assert({
    given: 'a busy lane with a slow and a queued operation, and a quiet lane',
    should: 'write each lane once and name only the slow and queued operations',
    actual: lines.map(({ event, fields }) => [
      event,
      fields.lane,
      'operation' in fields ? fields.operation : null,
    ]),
    expected: [
      ['db.lane.window', 'competitive', null],
      ['db.lane.hold', 'competitive', 'scanBilling'],
      ['db.lane.hold', 'competitive', 'readQueued'],
      ['db.lane.window', 'browse', null],
    ],
  });
  assert({
    given: 'the busy lane summary',
    should: 'carry its occupancy and the whole lane hold totals',
    actual: lines[0]?.fields,
    expected: {
      lane: 'competitive',
      connections: 10,
      samples: 2,
      activeSum: 8,
      activeMax: 6,
      waitingSum: 3,
      waitingMax: 3,
      holds: 42,
      durationMs: 1_903,
      maxMs: 1_200,
      p95Ms: 50,
      waits: 1,
    },
  });
  assert({
    given: 'a quiet lane with no holds',
    should: 'still report its window, with zero holds',
    actual: lines[3]?.fields,
    expected: {
      lane: 'browse',
      connections: 4,
      samples: 1,
      activeSum: 0,
      activeMax: 0,
      waitingSum: 0,
      waitingMax: 0,
      holds: 0,
      durationMs: 0,
      maxMs: 0,
      p95Ms: 0,
      waits: 0,
    },
  });
});

test('detail names every operation, as a measurement run needs', () => {
  assert({
    given: 'detail asked for (LOG_LEVEL debug)',
    should: 'write a hold line for every operation',
    actual: laneWindowLines({
      occupancy,
      holds: [competitiveHolds],
      detail: true,
    }).filter(({ event }) => event === 'db.lane.hold').length,
    expected: 3,
  });
});

test('the slow threshold is inclusive and adjustable', () => {
  assert({
    given: 'a 40 ms threshold',
    should: 'name an operation whose worst hold reached it',
    actual: laneWindowLines({
      occupancy,
      holds: [competitiveHolds],
      detail: false,
      slowHoldMs: 40,
    }).filter(({ event }) => event === 'db.lane.hold').length,
    expected: 3,
  });
});

test('holds on a lane with no sample still report', () => {
  assert({
    given: 'holds drained for a lane opened after the last sample',
    should: 'report the lane with empty occupancy',
    actual: laneWindowLines({
      occupancy: new Map(),
      holds: [{ ...competitiveHolds, operations: [] }],
      detail: false,
    }).map(({ fields }) => [fields.lane, fields.holds]),
    expected: [['competitive', 42]],
  });
});
