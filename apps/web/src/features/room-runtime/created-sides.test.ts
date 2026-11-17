import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createdSides } from './created-sides';

setupRitewayBun();

const casual = {
  competitionType: 'casual' as const,
  sides: undefined,
  castNamesDebater: false,
  seats: { affirmative: 1, negative: 1 },
};

test('a new Room’s sides (ADR 0143)', () => {
  assert({
    given:
      'a casual Room, a ranked one asking for fixed sides, unequal teams asking for open sides, a Tab cast naming a debater, explicit open and fixed, and practice’s open sides with its bot seated',
    should:
      'flip by default and always when ranked, fix unequal teams and a named cast, and otherwise do as asked',
    actual: [
      createdSides(casual),
      createdSides({ ...casual, competitionType: 'ranked', sides: 'fixed' }),
      createdSides({
        ...casual,
        sides: 'open',
        seats: { affirmative: 2, negative: 3 },
      }),
      createdSides({ ...casual, castNamesDebater: true }),
      createdSides({ ...casual, sides: 'open' }),
      createdSides({ ...casual, sides: 'fixed' }),
      createdSides({ ...casual, sides: 'open', castNamesDebater: true }),
    ],
    expected: [
      null,
      null,
      'affirmative',
      'affirmative',
      null,
      'affirmative',
      null,
    ],
  });
});
