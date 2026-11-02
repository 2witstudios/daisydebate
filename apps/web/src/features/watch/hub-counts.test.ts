import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { countHub } from './list-live';

setupRitewayBun();

describe('countHub', () => {
  test('counts public live Rounds and public ready recordings', () => {
    assert({
      given: 'the sample Rounds',
      should: 'count the listed live ones and the replayable public archive',
      actual: countHub(),
      expected: { live: 8, recordings: 6 },
    });
  });
});
