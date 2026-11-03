import { assert, setupRitewayBun, test } from 'riteway/bun';
import { floorDueAt, type FloorClock } from './floor-clock';

setupRitewayBun();

const at = (ms: number) => new Date(ms).toISOString();
const clock = (lastSegment: FloorClock['lastSegment']): FloorClock => ({
  startedAt: at(0),
  countdownMs: 1_000,
  segmentTotal: 3,
  prepBudgetMs: null,
  activePrep: null,
  segmentCount: 1,
  lastSegment,
});

test('the floor is due at the latest committed change, never a future one', () => {
  const yielded = clock({
    startedAt: at(5_000),
    endedAt: at(8_000),
    durationMs: 60_000,
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
      clock({ startedAt: at(5_000), endedAt: null, durationMs: 2_000 }),
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
