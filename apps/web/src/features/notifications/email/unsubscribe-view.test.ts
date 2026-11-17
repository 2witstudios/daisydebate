import { assert, setupRitewayBun, test } from 'riteway/bun';
import { unsubscribeViewOf } from './unsubscribe-view';

setupRitewayBun();

test('unsubscribeViewOf', () => {
  assert({
    given: 'a link, a done answer, a refusal and a link missing its token',
    should: 'confirm, report done, and call the rest not valid',
    actual: [
      unsubscribeViewOf({ u: 'u1', t: 'tok' }),
      unsubscribeViewOf({ done: '1' }),
      unsubscribeViewOf({ invalid: '1' }),
      unsubscribeViewOf({ u: 'u1' }),
    ],
    expected: [
      { kind: 'confirm', fields: { u: 'u1', t: 'tok' } },
      { kind: 'done' },
      { kind: 'invalid' },
      { kind: 'invalid' },
    ],
  });
});
