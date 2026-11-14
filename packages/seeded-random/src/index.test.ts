import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  canonicalJson,
  canonicalOrder,
  digestOf,
  shuffleWith,
  uniformIndex,
  wordStream,
} from './index';

setupRitewayBun();

const seed = new Uint8Array(32).fill(1);

describe('wordStream', () => {
  test('matches an independent SHA3-256 over domain, seed, prefix and counter', () => {
    // Computed with Bun's native SHA3-256 over
    // utf8("daisy-draw-v1/auto") ‖ 01×32 ‖ u32be(3) ‖ u32be(1).
    assert({
      given: 'word 1 of the stream for ordinal 3',
      should: 'be the first four bytes, big-endian, of SHA3-256 of the parts',
      actual: wordStream(
        'daisy-draw-v1/auto',
        seed,
        new Uint8Array([0, 0, 0, 3]),
      )(1),
      expected: 2_388_923_841,
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
});

describe('shuffleWith', () => {
  test('a shuffle is a permutation fixed by its stream', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'];
    const stream = wordStream('test/shuffle', seed, new Uint8Array());
    assert({
      given: 'six items and one stream, shuffled twice',
      should: 'give the same permutation of the same items both times',
      actual: [
        shuffleWith(items, stream).join(',') ===
          shuffleWith(items, stream).join(','),
        [...shuffleWith(items, stream)].sort().join(','),
      ],
      expected: [true, items.join(',')],
    });
  });
});

describe('digestOf', () => {
  test('a digest is the SHA3-256 of the UTF-8 text in hex', () => {
    assert({
      given: 'the empty string',
      should: 'be the published SHA3-256 of no bytes',
      actual: digestOf(''),
      expected:
        'a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a',
    });
  });
});
