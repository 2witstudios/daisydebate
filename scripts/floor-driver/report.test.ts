import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  compareControl,
  deadlineCell,
  percentile,
  summarizeServerLog,
} from './report';

setupRitewayBun();

test('percentiles are nearest rank on the samples themselves', () => {
  const samples = Array.from({ length: 100 }, (_, at) => at + 1);
  assert({
    given: 'the numbers 1 to 100',
    should: 'read p50, p95 and p99 as those ranks',
    actual: [50, 95, 99].map((rank) => percentile(samples, rank)),
    expected: [50, 95, 99],
  });
  assert({
    given: 'no samples',
    should: 'report nothing rather than a number',
    actual: percentile([], 50),
    expected: null,
  });
});

test('a cell under its deadline floor says so', () => {
  const cell = deadlineCell({
    n: 2,
    profile: 'held',
    required: 500,
    samplesMs: [100, 200, 300],
    missed: 1,
  });
  assert({
    given: 'three deadlines and one that never showed a grant',
    should: 'report them, invalid, with no claim of a full cell',
    actual: cell,
    expected: {
      n: 2,
      profile: 'held',
      deadlines: 3,
      missed: 1,
      required: 500,
      valid: false,
      p50Ms: 200,
      p95Ms: 300,
      p99Ms: 300,
      maxMs: 300,
    },
  });
  assert({
    given: 'enough deadlines but one missed',
    should: 'stay invalid, since the max would hide it',
    actual: deadlineCell({
      n: 2,
      profile: 'held',
      required: 3,
      samplesMs: [100, 200, 300],
      missed: 1,
    }).valid,
    expected: false,
  });
});

test('a server log gives refusals, cost per floor change and lane use', () => {
  const summary = summarizeServerLog([
    {
      event: 'db.capacity.refused',
      operation: 'media.capture',
      cause: 'competitive.saturated',
    },
    {
      event: 'db.capacity.refused',
      operation: 'media.capture',
      cause: 'competitive.saturated',
    },
    {
      event: 'round.media.floor_moved',
      mover: 'tick',
      dueAtMs: 10,
      appliedAtMs: 60,
    },
    {
      event: 'round.media.floor_moved',
      mover: 'browser',
      dueAtMs: 10,
      appliedAtMs: 30,
    },
    {
      event: 'round.media.pass',
      mover: 'tick',
      durationMs: 100,
      vendorCalls: 3,
      vendorMs: 40,
      vendorCallsOutsidePasses: 1,
    },
    {
      event: 'round.media.pass',
      mover: 'tick',
      durationMs: 300,
      vendorCalls: 2,
      vendorMs: 40,
      vendorCallsOutsidePasses: 0,
    },
    {
      event: 'db.lane.gauge',
      lane: 'competitive',
      connections: 10,
      samples: 20,
      activeSum: 40,
      activeMax: 8,
      waitingSum: 10,
      waitingMax: 3,
    },
    {
      event: 'db.lane.hold',
      lane: 'competitive',
      operation: 'readMediaSession',
      holds: 10,
      durationMs: 500,
      maxMs: 90,
      p95Ms: 80,
    },
    { event: 'http.request.completed' },
  ]);
  assert({
    given: 'one window of server events',
    should: 'report each measure, labelling the bound on hold p95',
    actual: summary,
    expected: {
      refusals: [{ lane: 'competitive', operation: 'media.capture', count: 2 }],
      floorMoves: { tick: 1, browser: 1, capture: 0 },
      passes: 2,
      passesPerFloorChange: 1,
      vendorCallsPerFloorChange: 3,
      vendorShareOfPassTime: 0.2,
      lanes: [
        {
          lane: 'competitive',
          connections: 10,
          activeMean: 2,
          activeMax: 8,
          waitingMean: 0.5,
          waitingMax: 3,
        },
      ],
      holds: [
        {
          lane: 'competitive',
          operation: 'readMediaSession',
          holds: 10,
          totalMs: 500,
          worstWindowP95Ms: 80,
          maxMs: 90,
        },
      ],
    },
  });
});

test('a control Round agrees only within the stated bound', () => {
  assert({
    given: 'driver and browser p95 within the bound',
    should: 'agree and state the gap',
    actual: compareControl({
      driverMs: [300, 400, 500],
      browserMs: [350, 450, 700],
      boundMs: 250,
    }),
    expected: {
      browserDeadlines: 3,
      browserP50Ms: 450,
      browserP95Ms: 700,
      driverP50Ms: 400,
      driverP95Ms: 500,
      p50GapMs: 50,
      p95GapMs: 200,
      boundMs: 250,
      agrees: true,
    },
  });
  assert({
    given: 'a browser Round with no deadlines',
    should: 'not agree',
    actual: compareControl({ driverMs: [300], browserMs: [], boundMs: 250 })
      .agrees,
    expected: false,
  });
});
