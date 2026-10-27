import { createAppError } from '@daisy/errors';
import { sha3_256 } from '@noble/hashes/sha3.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * The draw's deterministic randomness (`daisy-draw-v1`). The seed comes
 * from the OS CSPRNG at the edge; everything here is a pure function of it,
 * so operators can replay a draw from its committed inputs.
 */
const utf8 = (text: string) => utf8ToBytes(text);

const u32be = (value: number) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
};

const concat = (...parts: readonly Uint8Array[]) => {
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

export const bytesOf = (hex: string) => {
  if (!/^(?:[0-9a-f]{2})*$/.test(hex))
    throw createAppError('INVARIANT', 'Invalid hex');
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );
};

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

const compareBytes = (a: string, b: string) => {
  const left = utf8(a);
  const right = utf8(b);
  for (let i = 0; i < Math.min(left.length, right.length); i += 1)
    if (left[i] !== right[i]) return left[i]! - right[i]!;
  return left.length - right.length;
};

/** Canonical candidate order: ids as UTF-8 bytes, ascending. */
export const canonicalOrder = <T extends { readonly id: string }>(
  items: readonly T[],
) => [...items].sort((a, b) => compareBytes(a.id, b.id));

/** Fisher–Yates from the last index down, over one draw stream. */
export const shuffle = <T>(items: readonly T[], seed: Uint8Array): T[] => {
  const stream = wordStream('daisy-draw-v1/draw', seed, new Uint8Array());
  const out = [...items];
  let at = 0;
  for (let i = out.length - 1; i >= 1; i -= 1) {
    const pick = uniformIndex(stream, at, i + 1);
    at = pick.next;
    [out[i], out[pick.index]] = [out[pick.index]!, out[i]!];
  }
  return out;
};

/** An automatic side's strike: its own stream per ordinal. */
export const automaticChoice = (
  seed: Uint8Array,
  ordinal: number,
  standing: readonly number[],
) =>
  standing[
    uniformIndex(
      wordStream('daisy-draw-v1/auto', seed, u32be(ordinal)),
      0,
      standing.length,
    ).index
  ]!;

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

/** The salted commitment to a draw's private inputs. */
export const inputCommitment = (salt: Uint8Array, canonicalInputs: string) =>
  hexOf(
    sha3_256(concat(utf8('daisy-draw-v1/inputs'), salt, utf8(canonicalInputs))),
  );

/** The draw commitment: Room, draw, manifest digest and seed. */
export const drawCommitment = (input: {
  readonly roomId: string;
  readonly drawId: string;
  readonly manifestDigest: string;
  readonly seed: Uint8Array;
}) =>
  hexOf(
    sha3_256(
      concat(
        utf8('daisy-draw-v1/commit'),
        utf8(input.roomId),
        new Uint8Array([0]),
        utf8(input.drawId),
        new Uint8Array([0]),
        bytesOf(input.manifestDigest),
        input.seed,
      ),
    ),
  );
