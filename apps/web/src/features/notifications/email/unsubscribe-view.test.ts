import { assert, setupRitewayBun, test } from 'riteway/bun';
import { unsubscribeViewOf } from './unsubscribe-view';

setupRitewayBun();

test('unsubscribeViewOf', () => {
  assert({
    given: 'a link, a done answer, a refusal and a kind never emailed',
    should: 'confirm, report done, and call the rest not valid',
    actual: [
      unsubscribeViewOf({ u: 'u1', k: 'room_invitation', t: 'tok' }),
      unsubscribeViewOf({ done: 'challenge_received' }),
      unsubscribeViewOf({ invalid: '1' }),
      unsubscribeViewOf({ u: 'u1', k: 'recording_ready', t: 'tok' }),
    ],
    expected: [
      {
        kind: 'confirm',
        subject: 'room_invitation',
        fields: { u: 'u1', k: 'room_invitation', t: 'tok' },
      },
      { kind: 'done', subject: 'challenge_received' },
      { kind: 'invalid' },
      { kind: 'invalid' },
    ],
  });
});
