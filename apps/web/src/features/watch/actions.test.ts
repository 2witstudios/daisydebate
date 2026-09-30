import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { inertReason, type InertAction } from './actions';

setupRitewayBun();

describe('inert actions', () => {
  test('each action says why it does nothing', () => {
    const all: readonly InertAction[] = [
      'follow',
      'react',
      'chat',
      'report',
      'notify',
      'clearHistory',
    ];
    assert({
      given: 'every inert action',
      should: 'give a distinct, non-empty reason',
      actual:
        new Set(all.map(inertReason)).size === all.length &&
        all.every((action) => inertReason(action).length > 0),
      expected: true,
    });
  });
});
