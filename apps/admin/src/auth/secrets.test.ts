import { assert, setupRitewayBun, test } from 'riteway/bun';
import { isSecret, mintSecret, sha3 } from './secrets';

setupRitewayBun();
const counting = (length: number) =>
  Uint8Array.from({ length }, (_, index) => index);

test('mintSecret', () => {
  const secret = mintSecret(counting);
  assert({
    given: '32 injected random bytes',
    should: 'encode them as a 43-character base64url secret',
    actual: [secret.length, isSecret(secret)],
    expected: [43, true],
  });
});

test('isSecret', () => {
  assert({
    given: 'a value with padding, a wrong length or a non-string',
    should: 'refuse every one',
    actual: [`${'a'.repeat(42)}=`, 'a'.repeat(44), 42].map(isSecret),
    expected: [false, false, false],
  });
});

test('sha3', () => {
  assert({
    given: 'the empty string',
    should: 'return the SHA3-256 digest, not SHA-256',
    actual: sha3(''),
    expected:
      'a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a',
  });
});
