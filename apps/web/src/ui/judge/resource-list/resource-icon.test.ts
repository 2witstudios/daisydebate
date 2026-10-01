import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { resourceIcon } from './resource-icon';

setupRitewayBun();

describe('resourceIcon', () => {
  test('every kind', () => {
    assert({
      given: 'each resource kind',
      should: 'pick its own icon',
      actual: (
        [
          'guide',
          'criteria',
          'examples',
          'conflicts',
          'practice',
          'rating',
        ] as const
      ).map(resourceIcon),
      expected: ['book', 'check', 'message', 'alert', 'gavel', 'chart'],
    });
  });
});
