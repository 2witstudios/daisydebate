import { createHash, createHmac } from 'node:crypto';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  hmacSha256Base64,
  hmacSha256Base64url,
  hmacSha256Hex,
  sha1Base64,
  sha256Base64,
  sha256Hex,
  sha256Stream,
} from './index';

setupRitewayBun();

// The one place a native hasher may appear: proving these match it.
const key = new Uint8Array(32).map((_, index) => index * 7);
const texts = ['', 'abc', 'é ✓ \u{1F600}', 'x'.repeat(1000)];

test('SHA-256 matches the platform hasher byte for byte', () => {
  assert({
    given: 'empty, ASCII, multibyte and long text',
    should: 'give the hex and base64 node:crypto gives',
    actual: texts.map((text) => [sha256Hex(text), sha256Base64(text)]),
    expected: texts.map((text) => [
      createHash('sha256').update(text, 'utf8').digest('hex'),
      createHash('sha256').update(text, 'utf8').digest('base64'),
    ]),
  });
  assert({
    given: 'the FIPS 180-2 vector "abc"',
    should: 'give its published digest',
    actual: sha256Hex('abc'),
    expected:
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  });
});

test('streamed SHA-256 equals the one-shot digest', () => {
  const stream = sha256Stream();
  const bytes = new TextEncoder().encode('chunked '.repeat(300));
  for (let offset = 0; offset < bytes.length; offset += 97)
    stream.update(bytes.subarray(offset, offset + 97));
  assert({
    given: 'input fed in uneven chunks',
    should: 'give the digest of the whole',
    actual: stream.hex(),
    expected: sha256Hex(bytes),
  });
});

test('HMAC-SHA256 matches the platform MAC in every encoding', () => {
  assert({
    given: 'a byte key and each text',
    should: 'give the hex, base64 and base64url node:crypto gives',
    actual: texts.map((text) => [
      hmacSha256Hex(key, text),
      hmacSha256Base64(key, text),
      hmacSha256Base64url(key, text),
    ]),
    expected: texts.map((text) =>
      (['hex', 'base64', 'base64url'] as const).map((encoding) =>
        createHmac('sha256', key).update(text, 'utf8').digest(encoding),
      ),
    ),
  });
  assert({
    given: 'a text key',
    should: 'use its UTF-8 bytes',
    actual: hmacSha256Hex('secret', 'message'),
    expected: createHmac('sha256', 'secret').update('message').digest('hex'),
  });
});

test('SHA-1 serves only the WebSocket accept value', () => {
  assert({
    given: 'the RFC 6455 example key and GUID',
    should: 'give the RFC accept value',
    actual: sha1Base64(
      'dGhlIHNhbXBsZSBub25jZQ==258EAFA5-E914-47DA-95CA-C5AB0DC85B11',
    ),
    expected: 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=',
  });
});
