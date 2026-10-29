import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { canonicalRatingLadder, ratingLadders } from './primitives';

setupRitewayBun();

describe('canonicalRatingLadder', () => {
  test('only the three stable Daisy catalog identities name rating pools', () => {
    assert({
      given: 'canonical catalog IDs and custom or legacy format IDs',
      should:
        'map exactly the three ladders without label or revision inference',
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
        ladders: ['freestyle', 'policy', 'value'],
        mapped: ['freestyle', 'policy', 'value', null, null, null],
      },
    });
  });
});
