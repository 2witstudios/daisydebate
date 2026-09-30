import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { bandAccepts, roomRating } from './room';
import { liveRoom, openRoom } from './room.test-support';

setupRitewayBun();

describe('roomRating', () => {
  test('ranks an open table by its host', () => {
    assert({
      given: 'an open table hosted at 1512',
      should: 'rate it 1512',
      actual: roomRating(openRoom({ host: { handle: 'h', rating: 1512 } })),
      expected: 1512,
    });
  });

  test('ranks a live room by the mean of both players, rounded', () => {
    assert({
      given: 'a live room of 1705 against 1690',
      should: 'round the mean 1697.5 up to 1698',
      actual: roomRating(
        liveRoom({
          host: { handle: 'a', rating: 1705 },
          opponent: { handle: 'b', rating: 1690 },
        }),
      ),
      expected: 1698,
    });
  });
});

describe('bandAccepts', () => {
  const band = { min: 1300, max: 1700 };
  const cases = [
    ['one below the minimum', 1299, false],
    ['exactly the minimum', 1300, true],
    ['inside the band', 1500, true],
    ['exactly the maximum', 1700, true],
    ['one above the maximum', 1701, false],
  ] as const;
  for (const [given, rating, expected] of cases) {
    test(given, () => {
      assert({
        given: `a 1300–1700 band and a rating ${given}`,
        should: expected ? 'accept it' : 'refuse it',
        actual: bandAccepts(band, rating),
        expected,
      });
    });
  }

  test('an unbounded band', () => {
    assert({
      given: 'a band with no ends',
      should: 'accept any rating',
      actual: [
        bandAccepts({ min: null, max: null }, 0),
        bandAccepts({ min: null, max: null }, 9999),
        bandAccepts({ min: 1600, max: null }, 2400),
        bandAccepts({ min: null, max: 1400 }, 1401),
      ],
      expected: [true, true, true, false],
    });
  });
});
