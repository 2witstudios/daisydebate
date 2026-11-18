import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ladderName } from './ladder-name';

setupRitewayBun();

describe('ladderName', () => {
  test('each division', () => {
    assert({
      given: 'the Youth ladder with 412 debaters and the Open one with one',
      should: 'name each ladder and who may debate on it, with its count',
      actual: [
        ladderName({ style: 'freestyle', division: 'youth' }, 412),
        ladderName({ style: 'freestyle', division: 'open' }, 1),
      ].map(({ label, audience }) => [label, audience]),
      expected: [
        ['Youth – Freestyle', 'Members under 18 · 412 debaters'],
        ['Open – Freestyle', 'Members 18 and over · 1 debater'],
      ],
    });
  });
});
