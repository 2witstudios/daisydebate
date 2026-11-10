import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  unsubscribeToken,
  unsubscribeUrl,
  verifyUnsubscribe,
} from './unsubscribe-token';

setupRitewayBun();

const subkey = 'a'.repeat(64);
const userId = 'u'.repeat(24);

test('verifyUnsubscribe', () => {
  const token = unsubscribeToken(subkey, userId, 'room_invitation');
  assert({
    given: 'the token made for a member and kind, then tampered variants',
    should: 'accept only the one made for exactly that member and kind',
    actual: [
      verifyUnsubscribe(subkey, { userId, kind: 'room_invitation', token }),
      verifyUnsubscribe(subkey, { userId, kind: 'challenge_received', token }),
      verifyUnsubscribe(subkey, {
        userId: 'v'.repeat(24),
        kind: 'room_invitation',
        token,
      }),
      verifyUnsubscribe('b'.repeat(64), {
        userId,
        kind: 'room_invitation',
        token,
      }),
      verifyUnsubscribe(subkey, { userId, kind: 'recording_ready', token }),
      verifyUnsubscribe(subkey, { userId, kind: 'room_invitation', token: null }),
    ],
    expected: [{ userId, kind: 'room_invitation' }, null, null, null, null, null],
  });
});

test('unsubscribeUrl', () => {
  const url = new URL(
    unsubscribeUrl('https://daisy.test', subkey, {
      userId,
      kind: 'challenge_received',
    }),
  );
  assert({
    given: 'a member and kind',
    should: 'link to the unsubscribe page with a token that verifies',
    actual: [
      url.pathname,
      verifyUnsubscribe(subkey, {
        userId: url.searchParams.get('u'),
        kind: url.searchParams.get('k'),
        token: url.searchParams.get('t'),
      }),
    ],
    expected: [
      '/notifications/unsubscribe',
      { userId, kind: 'challenge_received' },
    ],
  });
});
