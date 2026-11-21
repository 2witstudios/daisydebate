import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { roundLadderOf } from './member-history-rows';

setupRitewayBun();

describe('roundLadderOf', () => {
  test('a ranked Round names its ladder; a casual one none', () => {
    assert({
      given:
        'a ranked Youth Round without a pool, a casual Round, and a ladder with no known age',
      should: 'name Youth – Freestyle, then no ladder twice',
      actual: [
        roundLadderOf({
          ladderId: null,
          ladderAgeRule: 'under-18',
          competitionType: 'ranked',
        }),
        roundLadderOf({
          ladderId: null,
          ladderAgeRule: 'adults',
          competitionType: 'casual',
        }),
        roundLadderOf({
          ladderId: 'freestyle',
          ladderAgeRule: null,
          competitionType: 'ranked',
        }),
      ],
      expected: [{ style: 'freestyle', division: 'youth' }, null, null],
    });
  });
});
