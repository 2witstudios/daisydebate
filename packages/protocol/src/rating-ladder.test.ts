import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { roundRatingScopeSchema } from './rating-ladder';
import { canonicalRatingStyle, ratingStyles } from './primitives';

setupRitewayBun();

describe('canonicalRatingStyle', () => {
  test('only Freestyle, the one Daisy standard, names a rating pool', () => {
    assert({
      given:
        'the Freestyle ID, the deleted Policy and Value IDs, and custom or legacy format IDs',
      should: 'map exactly the one ladder without label or revision inference',
      actual: {
        ladders: ratingStyles,
        mapped: [
          'freestyle',
          'policy',
          'value',
          'one-on-one',
          'custom',
          'Policy',
        ].map(canonicalRatingStyle),
      },
      expected: {
        ladders: ['freestyle'],
        mapped: ['freestyle', null, null, null, null, null],
      },
    });
  });
});

describe('roundRatingScopeSchema', () => {
  test('requires the complete frozen scope of a rated Round', () => {
    const scope = { lobbyId: 'lobby', ladderId: 'ladder', seasonId: 'season' };
    assert({
      given: 'a complete scope, a missing season and a casual Round',
      should: 'accept a complete scope or no scope',
      actual: [scope, { ...scope, seasonId: null }, null].map(
        (value) => roundRatingScopeSchema.safeParse(value).success,
      ),
      expected: [true, false, true],
    });
  });
});
