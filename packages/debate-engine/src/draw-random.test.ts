import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { hexOf } from '@daisy/seeded-random';
import { automaticChoice, bytesOf, shuffle } from './draw-random';

setupRitewayBun();

const seed = bytesOf('01'.repeat(32));

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

describe('hex', () => {
  test('hex round-trips', () => {
    assert({
      given: 'a seed',
      should: 'encode and decode to the same bytes',
      actual: hexOf(bytesOf('0a'.repeat(32))),
      expected: '0a'.repeat(32),
    });
  });
});
