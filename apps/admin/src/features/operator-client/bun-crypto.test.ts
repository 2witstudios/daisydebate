import { createHash, createHmac } from 'node:crypto';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { bunOperatorCrypto } from './bun-crypto';

setupRitewayBun();

test('the admin edge hash primitives', () => {
  const key = new Uint8Array(32).map((_, index) => index * 7);
  const text = 'DAISY-OPERATOR-V1\ndaisy-web:local\nGET';
  const bytes = new TextEncoder().encode('{"v":1}');
  assert({
    given: 'the same key, text and bytes',
    should:
      'produce exactly what node:crypto produces, as the participant app verifies with it',
    actual: [
      bunOperatorCrypto.hmacSha256(key, text),
      bunOperatorCrypto.sha256Hex(bytes),
      bunOperatorCrypto.sha3Hex(text),
    ],
    expected: [
      createHmac('sha256', key).update(text, 'utf8').digest('base64url'),
      createHash('sha256').update(bytes).digest('hex'),
      createHash('sha3-256').update(text, 'utf8').digest('hex'),
    ],
  });
});
