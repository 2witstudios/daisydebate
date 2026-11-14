import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { bracketFirstRound } from './index';

setupRitewayBun();

describe('the standard seeded tree', () => {
  test('a full bracket of sixteen', () => {
    assert({
      given: 'sixteen seeds',
      should: 'pair 1-16, 8-9, 5-12, 4-13, 3-14, 6-11, 7-10, 2-15 (0-based)',
      actual: bracketFirstRound(16),
      expected: [
        [0, 15],
        [7, 8],
        [4, 11],
        [3, 12],
        [2, 13],
        [5, 10],
        [6, 9],
        [1, 14],
      ],
    });
  });

  test('thirteen entries: three byes to the top three seeds', () => {
    // Bracket of 16; seeds 14, 15 and 16 do not exist, so 3, 2 and 1 have byes.
    assert({
      given: 'thirteen seeds',
      should: 'give seeds 1, 2 and 3 a bye and pair the rest by the tree',
      actual: bracketFirstRound(13),
      expected: [
        [0, null],
        [7, 8],
        [4, 11],
        [3, 12],
        [2, null],
        [5, 10],
        [6, 9],
        [1, null],
      ],
    });
  });

  test('small fields', () => {
    assert({
      given: 'zero, one, two and three seeds',
      should: 'give nothing, a lone bye, a final, and a bye to seed 1',
      actual: [
        bracketFirstRound(0),
        bracketFirstRound(1),
        bracketFirstRound(2),
        bracketFirstRound(3),
      ],
      expected: [
        [],
        [[0, null]],
        [[0, 1]],
        [
          [0, null],
          [1, 2],
        ],
      ],
    });
  });
});
