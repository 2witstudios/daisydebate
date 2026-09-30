import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { canTakeSeat } from './eligibility';
import { liveRoom, openRoom } from './room.test-support';

setupRitewayBun();

const ranked = openRoom({ mode: 'ranked', band: { min: 1300, max: 1700 } });

describe('canTakeSeat', () => {
  test('a ranked table at and outside the band edges', () => {
    assert({
      given: 'a ranked table accepting 1300–1700',
      should: 'seat 1300 and 1700 but not 1299 or 1701',
      actual: [1299, 1300, 1700, 1701].map((rating) =>
        canTakeSeat(ranked, { rating }),
      ),
      expected: [false, true, true, false],
    });
  });

  test('a ranked table with no band', () => {
    assert({
      given: 'a ranked table accepting any rating',
      should: 'seat every viewer',
      actual: canTakeSeat(openRoom({ mode: 'ranked' }), { rating: 100 }),
      expected: true,
    });
  });

  test('a casual table ignores the band', () => {
    assert({
      given: 'a casual table whose band excludes the viewer',
      should: 'still seat them',
      actual: canTakeSeat(
        openRoom({ mode: 'casual', band: { min: 1600, max: 1800 } }),
        { rating: 1000 },
      ),
      expected: true,
    });
  });

  test('a live room has no seat to take', () => {
    assert({
      given: 'a live room',
      should: 'offer no seat',
      actual: canTakeSeat(liveRoom(), { rating: 1500 }),
      expected: false,
    });
  });
});
