import { roundStartPolicy } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { floorBoundaries, floorDueAt, type FloorClock } from './floor-clock';

setupRitewayBun();

const at = (ms: number) => new Date(ms).toISOString();
const clock = (lastSegment: FloorClock['lastSegment']): FloorClock => ({
  startedAt: at(0),
  countdownMs: 1_000,
  segmentTotal: 3,
  prepBudgetMs: null,
  activePrep: null,
  stops: [],
  prepEndedAt: null,
  startGateAt: null,
  hold: null,
  segmentCount: 1,
  lastSegment,
});

test('the floor is due at the latest committed change, never a future one', () => {
  const yielded = clock({
    startedAt: at(5_000),
    endedAt: at(8_000),
    durationMs: 60_000,
    returnedMs: 0,
  });
  assert({
    given: 'a yield committed, its countdown still running',
    should: 'be due at the yield',
    actual: floorDueAt(yielded, 8_500),
    expected: 8_000,
  });
  assert({
    given: 'that countdown over',
    should: 'be due at the boundary, not when anyone noticed',
    actual: floorDueAt(yielded, 9_400),
    expected: 9_000,
  });
  assert({
    given: 'an open speech past its time',
    should: 'be due when its time ran out',
    actual: floorDueAt(
      clock({
        startedAt: at(5_000),
        endedAt: null,
        durationMs: 2_000,
        returnedMs: 0,
      }),
      7_100,
    ),
    expected: 7_000,
  });
  assert({
    given: 'a Round with nothing committed yet',
    should: 'have no due instant',
    actual: floorDueAt(
      { ...clock(null), startedAt: null, segmentCount: 0 },
      100,
    ),
    expected: null,
  });
});

test('a hold moves every wait', () => {
  const stop = { from: at(5_000), to: at(65_000) };
  const gap: FloorClock = {
    ...clock(null),
    segmentCount: 0,
    countdownMs: 10_000,
  };
  assert({
    given: 'a countdown a closed hold interrupted',
    should: 'be due that much later',
    actual: floorBoundaries({ ...gap, stops: [stop] }),
    expected: [70_000 - roundStartPolicy.microphoneLeadMs, 70_000],
  });
  assert({
    given: 'prep a closed hold interrupted',
    should: 'be due that much later',
    actual: floorBoundaries({
      ...gap,
      stops: [stop],
      prepBudgetMs: 20_000,
      activePrep: { startedAt: at(0), consumedMs: 0 },
    }),
    expected: [80_000],
  });
  assert({
    given: 'prep that ended, with a hold after it ended',
    should: 'read a move only at the clock, one lead and the hold later',
    actual: floorBoundaries({
      ...gap,
      stops: [{ from: at(500), to: at(60_500) }],
      prepEndedAt: at(0),
    }),
    expected: [60_000 + roundStartPolicy.microphoneLeadMs],
  });
  assert({
    given: 'a Round held, then counting down to resume',
    should: 'have no boundary, then only the countdown end',
    actual: [
      floorBoundaries({ ...gap, hold: { resumesAt: null } }),
      floorBoundaries({ ...gap, hold: { resumesAt: at(90_000) } }),
    ],
    expected: [[], [90_000]],
  });
  assert({
    given: 'a start gate holding the clock past its due',
    should: 'read a move at the gate instant, not the due',
    actual: floorBoundaries({ ...gap, startGateAt: at(10_700) }),
    expected: [10_000 - roundStartPolicy.microphoneLeadMs, 10_700],
  });
});
