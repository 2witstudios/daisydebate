import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { countHub } from './list-live';

setupRitewayBun();

describe('countHub', () => {
  test('counts public live debates and public ready recordings', () => {
    assert({
      given: 'the sample debates',
      should: 'count the listed live ones and the replayable public archive',
      actual: countHub(),
      expected: { live: 8, recordings: 6 },
    });
  });
});
