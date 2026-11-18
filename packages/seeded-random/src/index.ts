import { sha3_256 } from '@noble/hashes/sha3.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * Deterministic randomness from a seed. The seed comes from the OS CSPRNG at
 * the edge; everything here is a pure function of it, so a draw replays
 * from its recorded inputs. Each consumer names its own domain, so one
 * stream's words never shift another's.
 */
export const utf8 = (text: string) => utf8ToBytes(text);

export const u32be = (value: number) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
};

export const concat = (...parts: readonly Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

export const hexOf = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/** Word `i` of a stream: the first 4 bytes, big-endian, of its hash. */
export type WordStream = (index: number) => number;

export const wordStream =
  (domain: string, seed: Uint8Array, prefix: Uint8Array): WordStream =>
  (index) => {
    const hash = sha3_256(concat(utf8(domain), seed, prefix, u32be(index)));
    return new DataView(hash.buffer, hash.byteOffset).getUint32(0, false);
  };

/**
 * An unbiased index below `n`: words at or above the largest multiple of
 * `n` under 2³² are rejected and the next word is taken. Returns the index
 * and the next unread position of the stream.
 */
export const uniformIndex = (
  stream: WordStream,
  from: number,
  n: number,
): { readonly index: number; readonly next: number } => {
  const limit = Math.floor(2 ** 32 / n) * n;
  for (let at = from; ; at += 1) {
    const word = stream(at);
    if (word < limit) return { index: word % n, next: at + 1 };
  }
};

/** Two strings compared as UTF-8 bytes: negative, zero or positive. */
export const compareBytes = (a: string, b: string) => {
  const left = utf8(a);
  const right = utf8(b);
  for (let i = 0; i < Math.min(left.length, right.length); i += 1)
    if (left[i] !== right[i]) return left[i]! - right[i]!;
  return left.length - right.length;
};

/** Canonical order: ids as UTF-8 bytes, ascending. */
export const canonicalOrder = <T extends { readonly id: string }>(
  items: readonly T[],
) => [...items].sort((a, b) => compareBytes(a.id, b.id));

/** Fisher–Yates from the last index down, over one stream. */
export const shuffleWith = <T>(
  items: readonly T[],
  stream: WordStream,
): T[] => {
  const out = [...items];
  let at = 0;
  for (let i = out.length - 1; i >= 1; i -= 1) {
    const pick = uniformIndex(stream, at, i + 1);
    at = pick.next;
    [out[i], out[pick.index]] = [out[pick.index]!, out[i]!];
  }
  return out;
};

/** JSON with object keys sorted, so equal values hash equally. */
export const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner as Record<string, unknown>).sort(([a], [b]) =>
            compareBytes(a, b),
          ),
        )
      : inner,
  );

export const digestOf = (text: string) => hexOf(sha3_256(utf8(text)));
