import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { canonicalRatingLadder, ratingLadders } from './primitives';

setupRitewayBun();

describe('canonicalRatingLadder', () => {
  test('only Freestyle, the one Daisy standard, names a rating pool', () => {
    assert({
      given:
        'the Freestyle ID, the deleted Policy and Value IDs, and custom or legacy format IDs',
      should: 'map exactly the one ladder without label or revision inference',
      actual: {
        ladders: ratingLadders,
        mapped: [
          'freestyle',
          'policy',
          'value',
          'one-on-one',
          'custom',
          'Policy',
        ].map(canonicalRatingLadder),
      },
      expected: {
        ladders: ['freestyle'],
        mapped: ['freestyle', null, null, null, null, null],
      },
    });
  });
});
