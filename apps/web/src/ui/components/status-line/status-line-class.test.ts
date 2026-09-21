import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { statusDotClass } from './status-line-class';

setupRitewayBun();

describe('statusDotClass', () => {
  test('colors each tone', () => {
    assert({
      given: 'each tone',
      should: 'add its own fill to the dot base',
      actual: (['online', 'live', 'neutral'] as const).map(statusDotClass),
      expected: [
        'size-2 rounded-round bg-online',
        'size-2 rounded-round bg-live',
        'size-2 rounded-round bg-ink-faint',
      ],
    });
  });
});
