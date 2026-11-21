import { sha3_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/** SHA3-256 bytes for a byte-encoded domain input such as a seeded draw. */
export const sha3Bytes = (bytes: Uint8Array): Uint8Array => sha3_256(bytes);

/** SHA3-256 as lowercase hex. Text is encoded as UTF-8. */
export const sha3Hex = (value: string | Uint8Array): string =>
  bytesToHex(sha3Bytes(typeof value === 'string' ? utf8ToBytes(value) : value));

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
