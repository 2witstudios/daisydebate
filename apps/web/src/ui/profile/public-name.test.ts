import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { publicNameLabel } from './public-name';

setupRitewayBun();

describe('publicNameLabel', () => {
  test('with and without a display name', () => {
    assert({
      given: 'a member with a display name, then one without',
      should: 'keep the username heard beside the display name, or alone',
      actual: [
        publicNameLabel({ username: 'ada', displayName: 'Ada Byron' }),
        publicNameLabel({ username: 'ada', displayName: null }),
      ],
      expected: ['Ada Byron (@ada)', '@ada'],
    });
  });
});
