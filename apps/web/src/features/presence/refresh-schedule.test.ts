import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  nextReadDelayMs,
  ROSTER_CEILING_MS,
  ROSTER_FLOOR_MS,
  rosterFloorMs,
} from './refresh-schedule';

setupRitewayBun();

describe('rosterFloorMs', () => {
  test('grows with the list between its bounds', () => {
    assert({
      given: 'a handful, a thousand and a hundred thousand online',
      should: 'stay at the floor, then grow, then stop at the ceiling',
      actual: [rosterFloorMs(5), rosterFloorMs(1_000), rosterFloorMs(100_000)],
      expected: [ROSTER_FLOOR_MS, 20_000, ROSTER_CEILING_MS],
    });
  });
});

describe('nextReadDelayMs', () => {
  test('waits out the floor, then adds its jitter', () => {
    assert({
      given: 'a read 500ms ago with a 2s floor',
      should: 'wait the remaining 1500ms plus the jitter',
      actual: nextReadDelayMs({ now: 1_500, lastReadAt: 1_000, onlineCount: 2, jitter: 0.5 }),
      expected: 2_000,
    });
  });
  test('a read long ago is due now, jitter aside', () => {
    assert({
      given: 'no read for a minute',
      should: 'not wait',
      actual: nextReadDelayMs({ now: 61_000, lastReadAt: 1_000, onlineCount: 2, jitter: 0 }),
      expected: 0,
    });
  });
});
