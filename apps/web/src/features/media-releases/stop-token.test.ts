import { assert, setupRitewayBun, test } from 'riteway/bun';
import { releaseStopToken, verifyReleaseStop } from './stop-token';

setupRitewayBun();

test('a release stop link', () => {
  const hash = 'a'.repeat(64);
  const token = releaseStopToken('key', hash);
  assert({
    given: 'the token this key made for the hash',
    should: 'verify to the hash',
    actual: verifyReleaseStop('key', { recipientHash: hash, token }),
    expected: hash,
  });
  assert({
    given: 'another key, another hash or a malformed hash',
    should: 'not verify',
    actual: [
      verifyReleaseStop('other', { recipientHash: hash, token }),
      verifyReleaseStop('key', { recipientHash: 'b'.repeat(64), token }),
      verifyReleaseStop('key', { recipientHash: 'x', token }),
      verifyReleaseStop('key', { recipientHash: hash, token: 7 }),
    ],
    expected: [null, null, null, null],
  });
});
