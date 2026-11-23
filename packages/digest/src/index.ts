import { hmac } from '@noble/hashes/hmac.js';
import { sha1 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { sha3_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * Every hash and MAC in the repository is computed here. The functions are
 * pure JavaScript, so the package loads in a server, a worker and a client
 * bundle alike. Text is always encoded as UTF-8.
 */
type Input = string | Uint8Array;

const bytesOf = (value: Input): Uint8Array =>
  typeof value === 'string' ? utf8ToBytes(value) : value;

const base64Alphabet =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** RFC 4648 base64 with padding, written out so no runtime global is needed. */
const base64 = (bytes: Uint8Array): string => {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const [a = 0, b = 0, c = 0] = bytes.subarray(index, index + 3);
    const word = (a << 16) | (b << 8) | c;
    const left = bytes.length - index;
    out +=
      base64Alphabet.charAt((word >> 18) & 63) +
      base64Alphabet.charAt((word >> 12) & 63) +
      (left > 1 ? base64Alphabet.charAt((word >> 6) & 63) : '=') +
      (left > 2 ? base64Alphabet.charAt(word & 63) : '=');
  }
  return out;
};

const base64url = (bytes: Uint8Array): string =>
  base64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

/** SHA3-256 bytes for a byte-encoded domain input such as a seeded draw. */
export const sha3Bytes = (bytes: Uint8Array): Uint8Array => sha3_256(bytes);

/** SHA3-256 as lowercase hex: the digest for secrets and content identity. */
export const sha3Hex = (value: Input): string =>
  bytesToHex(sha3Bytes(bytesOf(value)));

/**
 * Hash a command's serialized payload. The default encodes JSON in the
 * command schema's field order. A contract with its own wire encoding
 * supplies that encoding so retries keep the same digest.
 */
export function commandDigest(
  payload: unknown,
  encode: (payload: unknown) => string | undefined = JSON.stringify,
): string {
  const encoded = encode(payload);
  if (encoded === undefined)
    throw new TypeError('Command payload must serialize to text');
  return sha3Hex(encoded);
}

/** SHA-256 bytes, where a binary format embeds the hash (WebAuthn). */
export const sha256Bytes = (value: Input): Uint8Array => sha256(bytesOf(value));

/**
 * SHA-256 as lowercase hex, where an outside format names SHA-2: the
 * operator signature's body hash, Drizzle's migration hash, vendor receipts.
 */
export const sha256Hex = (value: Input): string =>
  bytesToHex(sha256(bytesOf(value)));

/** SHA-256 as base64, the form a Content-Security-Policy source hash takes. */
export const sha256Base64 = (value: Input): string =>
  base64(sha256(bytesOf(value)));

/** SHA-256 over input that arrives in chunks, such as a large file. */
export function sha256Stream() {
  const state = sha256.create();
  return {
    update(chunk: Uint8Array) {
      state.update(chunk);
    },
    hex: (): string => bytesToHex(state.digest()),
  };
}

/** SHA-1 as base64: only the WebSocket handshake's `Sec-WebSocket-Accept`. */
export const sha1Base64 = (value: Input): string =>
  base64(sha1(bytesOf(value)));

/** HMAC-SHA256 bytes of `message` under `key`. */
const hmacSha256 = (key: Input, message: Input): Uint8Array =>
  hmac(sha256, bytesOf(key), bytesOf(message));

/** HMAC-SHA256 as lowercase hex. */
export const hmacSha256Hex = (key: Input, message: Input): string =>
  bytesToHex(hmacSha256(key, message));

/** HMAC-SHA256 as base64. */
export const hmacSha256Base64 = (key: Input, message: Input): string =>
  base64(hmacSha256(key, message));

/** HMAC-SHA256 as unpadded base64url. */
export const hmacSha256Base64url = (key: Input, message: Input): string =>
  base64url(hmacSha256(key, message));
