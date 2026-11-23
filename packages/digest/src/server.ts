import { createHash } from 'node:crypto';

/**
 * SHA-256 over input that arrives in chunks, on the platform's native hasher,
 * for a server process hashing large files (the browser suite's image cache
 * hashes multi-gigabyte archives, where pure JavaScript is about 15 times
 * slower). Never imported by a client bundle; `sha2.test.ts` holds it equal
 * to `sha256Hex`.
 */
export function nativeSha256Stream() {
  const state = createHash('sha256');
  return {
    update(chunk: Uint8Array) {
      state.update(chunk);
    },
    hex: (): string => state.digest('hex'),
  };
}
