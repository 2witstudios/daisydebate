import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { roundLadderOf } from './member-history-rows';

setupRitewayBun();

describe('roundLadderOf', () => {
  test('a ranked Round names its ladder; a casual one none', () => {
    assert({
      given:
        'a ranked Youth Freestyle Round, a casual Round, and a value outside the vocabulary',
      should: 'name Youth – Freestyle, then no ladder twice',
      actual: [
        roundLadderOf({ ladderId: 'freestyle', ladderDivision: 'youth' }),
        roundLadderOf({ ladderId: null, ladderDivision: null }),
        roundLadderOf({ ladderId: 'freestyle', ladderDivision: 'senior' }),
      ],
      expected: [{ style: 'freestyle', division: 'youth' }, null, null],
    });
  });
});
