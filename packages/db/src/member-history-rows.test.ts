import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { roundLadderOf } from './member-history-rows';

setupRitewayBun();

describe('roundLadderOf', () => {
  test('a ranked Round names its ladder; a casual one none', () => {
    assert({
      given:
        'a ranked Youth Freestyle Round, a casual Round, and a ladder with no known lobby',
      should: 'name Youth – Freestyle, then no ladder twice',
      actual: [
        roundLadderOf({ ladderId: 'freestyle', ladderAgeRule: 'under-18' }),
        roundLadderOf({ ladderId: null, ladderAgeRule: null }),
        roundLadderOf({ ladderId: 'freestyle', ladderAgeRule: null }),
      ],
      expected: [{ style: 'freestyle', division: 'youth' }, null, null],
    });
  });
});
