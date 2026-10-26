import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  automaticChoice,
  bytesOf,
  canonicalJson,
  canonicalOrder,
  hexOf,
  shuffle,
  uniformIndex,
  wordStream,
} from './draw-random';

setupRitewayBun();

const seed = bytesOf('01'.repeat(32));

/** An independent SHA3-256 (Bun's native hasher) for cross-checking. */
const nativeWord = (bytes: Uint8Array) => {
  const hasher = new Bun.CryptoHasher('sha3-256');
  hasher.update(bytes);
  return new DataView(hasher.digest().buffer).getUint32(0, false);
};

describe('wordStream', () => {
  test('matches an independent SHA3-256 over domain, seed, prefix and counter', () => {
    const domain = new TextEncoder().encode('daisy-draw-v1/auto');
    const bytes = new Uint8Array([...domain, ...seed, 0, 0, 0, 3, 0, 0, 0, 1]);
    assert({
      given: 'word 1 of the stream for ordinal 3',
      should: 'be the first four bytes, big-endian, of SHA3-256 of the parts',
      actual: wordStream(
        'daisy-draw-v1/auto',
        seed,
        new Uint8Array([0, 0, 0, 3]),
      )(1),
      expected: nativeWord(bytes),
    });
  });
});

describe('uniformIndex', () => {
  test('a rejected word is skipped, never retried', () => {
    const words = [0xff_ff_ff_ff, 7];
    assert({
      given: 'a stream whose first word is at the rejection limit for 3',
      should: 'take the next word and report the position after it',
      actual: uniformIndex((i) => words[i]!, 0, 3),
      expected: { index: 1, next: 2 },
    });
  });

  test('an accepted word is used as is', () => {
    assert({
      given: 'a word below the limit',
      should: 'reduce it modulo n',
      actual: uniformIndex(() => 10, 4, 3),
      expected: { index: 1, next: 5 },
    });
  });
});

describe('shuffle and automatic choice', () => {
  const ids = Array.from(
    { length: 12 },
    (_, i) => `b${String(i).padStart(2, '0')}`,
  );

  test('known answers pin the algorithm', () => {
    assert({
      given: 'twelve ids and the all-01 seed',
      should: 'keep the committed daisy-draw-v1 order',
      actual: shuffle(ids, seed).join(','),
      expected: 'b05,b09,b02,b10,b03,b00,b08,b04,b01,b11,b06,b07',
    });
    assert({
      given: 'ordinals 1 and 2 over different standing sets',
      should: 'keep the committed automatic choices',
      actual: [
        automaticChoice(seed, 1, [0, 2, 3]),
        automaticChoice(seed, 2, [0, 1, 2, 3, 4]),
      ],
      expected: [0, 4],
    });
    assert({
      given: 'the same input twice',
      should: 'be a permutation of the input',
      actual: [...shuffle(ids, seed)].sort().join(','),
      expected: ids.join(','),
    });
  });

  test('different seeds give different draws', () => {
    assert({
      given: 'two seeds',
      should: 'not produce the same order',
      actual:
        shuffle(ids, seed).join(',') ===
        shuffle(ids, bytesOf('02'.repeat(32))).join(','),
      expected: false,
    });
  });

  test('automatic choice picks a standing position', () => {
    const standing = [0, 2, 3];
    assert({
      given: 'three standing positions',
      should: 'choose one of them, the same one every time',
      actual: [
        standing.includes(automaticChoice(seed, 1, standing)),
        automaticChoice(seed, 1, standing) ===
          automaticChoice(seed, 1, standing),
      ],
      expected: [true, true],
    });
  });
});

describe('canonical forms', () => {
  test('canonical JSON sorts keys at every depth', () => {
    assert({
      given: 'objects whose keys differ only in order',
      should: 'serialize identically',
      actual: canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } }),
      expected: '{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}',
    });
  });

  test('canonical order compares UTF-8 bytes', () => {
    assert({
      given: 'host ids h:10 and h:2',
      should: 'order them bytewise',
      actual: canonicalOrder([{ id: 'h:2' }, { id: 'h:10' }]).map((x) => x.id),
      expected: ['h:10', 'h:2'],
    });
  });

  test('hex round-trips', () => {
    assert({
      given: 'a seed',
      should: 'encode and decode to the same bytes',
      actual: hexOf(bytesOf('0a'.repeat(32))),
      expected: '0a'.repeat(32),
    });
  });
});
