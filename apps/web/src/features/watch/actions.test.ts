import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { actionLabel, type InertAction } from './actions';

setupRitewayBun();

describe('watch actions', () => {
  test('each action has its own label', () => {
    const all: readonly InertAction[] = [
      'follow',
      'react',
      'chat',
      'report',
      'notify',
      'clearHistory',
      'saveVisibility',
    ];
    assert({
      given: 'every Watch action',
      should: 'give a distinct, non-empty label for the banner',
      actual:
        new Set(all.map(actionLabel)).size === all.length &&
        all.every((action) => actionLabel(action).length > 0),
      expected: true,
    });
  });
});
