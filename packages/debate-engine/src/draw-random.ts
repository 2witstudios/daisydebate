import { createAppError } from '@daisy/errors';
import { sha3Bytes } from '@daisy/digest';
import {
  concat,
  hexOf,
  shuffleWith,
  u32be,
  uniformIndex,
  utf8,
  wordStream,
  type WordStream,
} from '@daisy/seeded-random';

/**
 * The draw's deterministic randomness (`daisy-draw-v1`). The seed comes
 * from the OS CSPRNG at the edge; everything here is a pure function of it,
 * so operators can replay a draw from its committed inputs.
 */
export const bytesOf = (hex: string) => {
  if (!/^(?:[0-9a-f]{2})*$/.test(hex))
    throw createAppError('INVARIANT', 'Invalid hex');
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );
};

/** Fisher–Yates from the last index down, over one draw stream. */
export const shuffle = <T>(items: readonly T[], seed: Uint8Array): T[] =>
  shuffleWith(items, wordStream('daisy-draw-v1/draw', seed, new Uint8Array()));

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

/** The salted commitment to a draw's private inputs. */
export const inputCommitment = (salt: Uint8Array, canonicalInputs: string) =>
  hexOf(
    sha3Bytes(
      concat(utf8('daisy-draw-v1/inputs'), salt, utf8(canonicalInputs)),
    ),
  );

/** The draw commitment: Room, draw, manifest digest and seed. */
export const drawCommitment = (input: {
  readonly roomId: string;
  readonly drawId: string;
  readonly manifestDigest: string;
  readonly seed: Uint8Array;
}) =>
  hexOf(
    sha3Bytes(
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

/** The seat draw's own stream (ADR 0145), apart from the resolution draw's. */
export const seatStream = (seed: Uint8Array): WordStream =>
  wordStream('daisy-draw-v1/seats', seed, new Uint8Array());

/** The seat draw commitment: Room, Round, the seats before the draw, and seed. */
export const seatCommitment = (input: {
  readonly roomId: string;
  readonly roundId: string;
  readonly seatsDigest: string;
  readonly seed: Uint8Array;
}) =>
  hexOf(
    sha3Bytes(
      concat(
        utf8('daisy-draw-v1/seats-commit'),
        utf8(input.roomId),
        new Uint8Array([0]),
        utf8(input.roundId),
        new Uint8Array([0]),
        bytesOf(input.seatsDigest),
        input.seed,
      ),
    ),
  );
