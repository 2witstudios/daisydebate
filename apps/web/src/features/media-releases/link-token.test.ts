import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  isReleaseLinkToken,
  newReleaseLinkToken,
  releaseLinkDigest,
  releaseLinkPath,
} from './link-token';

setupRitewayBun();

test('a release link token', () => {
  const token = newReleaseLinkToken();
  assert({
    given: 'a new token',
    should: 'be 43 base64url characters',
    actual: isReleaseLinkToken(token),
    expected: true,
  });
  assert({
    given: 'two new tokens',
    should: 'differ',
    actual: newReleaseLinkToken() === newReleaseLinkToken(),
    expected: false,
  });
  assert({
    given: 'a value of another shape',
    should: 'not be a token',
    actual: [
      isReleaseLinkToken('abc'),
      isReleaseLinkToken(`${token}=`),
      isReleaseLinkToken(42),
    ],
    expected: [false, false, false],
  });
  assert({
    given: 'one token under each purpose',
    should: 'store a different, prefixed SHA3-256 digest',
    actual: [
      /^sign:[0-9a-f]{64}$/u.test(releaseLinkDigest('sign', token)),
      releaseLinkDigest('sign', token).slice(5) ===
        releaseLinkDigest('manage', token).slice(7),
      releaseLinkDigest('sign', token) === releaseLinkDigest('manage', token),
    ],
    expected: [true, true, false],
  });
  assert({
    given: 'a token',
    should: 'never store the token itself',
    actual: releaseLinkDigest('sign', token).includes(token),
    expected: false,
  });
  assert({
    given: 'each purpose',
    should: 'open its own page with the token in the query',
    actual: [releaseLinkPath('sign', 'x'), releaseLinkPath('manage', 'y')],
    expected: ['/release?t=x', '/release/manage?t=y'],
  });
});
