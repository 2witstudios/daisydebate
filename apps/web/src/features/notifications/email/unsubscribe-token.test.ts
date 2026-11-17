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
  const token = unsubscribeToken(subkey, userId);
  assert({
    given: 'the token made for a member, then tampered variants',
    should: 'accept only the one made for exactly that member and key',
    actual: [
      verifyUnsubscribe(subkey, { userId, token }),
      verifyUnsubscribe(subkey, { userId: 'v'.repeat(24), token }),
      verifyUnsubscribe('b'.repeat(64), { userId, token }),
      verifyUnsubscribe(subkey, { userId, token: null }),
      verifyUnsubscribe(subkey, { userId: 'not an id', token }),
    ],
    expected: [{ userId }, null, null, null, null],
  });
});

test('unsubscribeUrl', () => {
  const url = new URL(unsubscribeUrl('https://daisy.test', subkey, { userId }));
  assert({
    given: 'a member',
    should: 'link to the unsubscribe page with a token that verifies',
    actual: [
      url.pathname,
      verifyUnsubscribe(subkey, {
        userId: url.searchParams.get('u'),
        token: url.searchParams.get('t'),
      }),
    ],
    expected: ['/unsubscribe', { userId }],
  });
});
