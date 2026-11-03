import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  nextReadDelayMs,
  PEOPLE_READ_CEILING_MS,
  PEOPLE_READ_FLOOR_MS,
  peopleReadCount,
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

describe('peopleReadCount', () => {
  const PAGE_ROWS = 50;
  const READS_PER_MINUTE_RULE = 240;
  /** Reads a minute under a ring every second: each re-read walks every page. */
  const readsPerMinute = (pages: number) => {
    const people = Array.from({ length: pages * PAGE_ROWS }, () => null);
    const peopleCount = peopleReadCount({ counts: { online: 20 }, people });
    let reads = 0;
    let lastReadAt = -60_000;
    for (let now = 0; now < 60_000; now += 1_000) {
      const delay = nextReadDelayMs({
        now,
        lastReadAt,
        peopleCount,
        jitter: 0,
      });
      if (delay === 0) {
        reads += pages;
        lastReadAt = now;
      }
    }
    return reads;
  };

  test('a long list slows its re-reads inside the read budget', () => {
    const pageCounts = [1, 5, 10, 11, 15, 20];
    assert({
      given: 'rings every second with 20 online and 1 to 20 pages loaded',
      should: 'stay inside the 240 reads a minute at every page count',
      actual: pageCounts.filter(
        (pages) => readsPerMinute(pages) > READS_PER_MINUTE_RULE,
      ),
      expected: [],
    });
  });

  test('takes whichever is larger, online or loaded', () => {
    assert({
      given: 'more online than loaded, then more loaded than online',
      should: 'answer the larger',
      actual: [
        peopleReadCount({ counts: { online: 90 }, people: [null] }),
        peopleReadCount({ counts: { online: 1 }, people: [null, null] }),
      ],
      expected: [90, 2],
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
        peopleCount: 2,
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
        peopleCount: 2,
        jitter: 0,
      }),
      expected: 0,
    });
  });
});
