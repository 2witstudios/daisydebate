import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  nextReadDelayMs,
  PEOPLE_READ_CEILING_MS,
  PEOPLE_READ_FLOOR_MS,
  peopleReadFloorMs,
} from './refresh-schedule';

setupRitewayBun();

describe('peopleReadFloorMs', () => {
  test('grows with the list between its bounds', () => {
    assert({
      given: 'a handful, a thousand and a hundred thousand online',
      should: 'stay at the floor, then grow, then stop at the ceiling',
      actual: [
        peopleReadFloorMs(5),
        peopleReadFloorMs(1_000),
        peopleReadFloorMs(100_000),
      ],
      expected: [PEOPLE_READ_FLOOR_MS, 20_000, PEOPLE_READ_CEILING_MS],
    });
  });
});

describe('nextReadDelayMs', () => {
  test('waits out the floor, then adds its jitter', () => {
    assert({
      given: 'a read 500ms ago with a 2s floor',
      should: 'wait the remaining 1500ms plus the jitter',
      actual: nextReadDelayMs({
        now: 1_500,
        lastReadAt: 1_000,
        onlineCount: 2,
        jitter: 0.5,
      }),
      expected: 2_000,
    });
  });
  test('a read long ago is due now, jitter aside', () => {
    assert({
      given: 'no read for a minute',
      should: 'not wait',
      actual: nextReadDelayMs({
        now: 61_000,
        lastReadAt: 1_000,
        onlineCount: 2,
        jitter: 0,
      }),
      expected: 0,
    });
  });
});
