import { assert, setupRitewayBun, test } from 'riteway/bun';
import { isYouthRound } from './youth-round';

setupRitewayBun();

test('isYouthRound', () => {
  const casual = { ladderDivision: null } as const;
  assert({
    given: 'a casual Round in a Youth Room and one in an Open Room',
    should: 'be a Youth Round only in the Youth Room',
    actual: [isYouthRound(casual, true), isYouthRound(casual, false)],
    expected: [true, false],
  });
  assert({
    given: 'a ranked Round, whose ladder is its Room division',
    should: 'follow the Room division',
    actual: [
      isYouthRound({ ladderDivision: 'youth' }, true),
      isYouthRound({ ladderDivision: 'open' }, false),
    ],
    expected: [true, false],
  });
  assert({
    given: 'a Youth ladder in an Open Room, which ADR 0162 never makes',
    should: 'still be Youth: the rule fails closed',
    actual: isYouthRound({ ladderDivision: 'youth' }, false),
    expected: true,
  });
  assert({
    given: 'a Round with no Room',
    should: 'fall back to its frozen ladder division',
    actual: [
      isYouthRound({ ladderDivision: 'youth' }, null),
      isYouthRound({ ladderDivision: 'open' }, null),
      isYouthRound(casual, null),
    ],
    expected: [true, false, false],
  });
});
