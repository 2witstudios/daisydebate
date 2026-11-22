import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fourTeams, twoSides } from '@daisy/protocol/seats';
import { createdSides } from './created-sides';

const seating = (affirmative: number, negative: number) => ({
  sides: twoSides,
  seats: {
    sides: { affirmative, negative },
    speakers: 0,
    judges: 1,
    moderators: 0,
  },
});

setupRitewayBun();

const casual = {
  competitionType: 'casual' as const,
  sides: undefined,
  castNamesDebater: false,
  seating: seating(1, 1),
};

test('a new Room’s sides (ADR 0145)', () => {
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
        seating: seating(2, 3),
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

test('an event Room’s sides (ADR 0145, Tab)', () => {
  assert({
    given:
      'a Tab event Room asking for nothing, for open sides and stored as ranked, and a casual Room whose format seats four teams',
    should:
      'fix the event Room’s sides as its draw seated them, and fix a Room with no two teams',
    actual: [
      createdSides({ ...casual, eventRoom: true }),
      createdSides({ ...casual, eventRoom: true, sides: 'open' }),
      createdSides({ ...casual, eventRoom: true, competitionType: 'ranked' }),
      createdSides({
        ...casual,
        sides: 'open',
        seating: {
          sides: fourTeams,
          seats: {
            sides: Object.fromEntries(fourTeams.map((side) => [side.key, 2])),
            speakers: 0,
            judges: 1,
            moderators: 0,
          },
        },
      }),
    ],
    expected: ['affirmative', 'affirmative', 'affirmative', 'affirmative'],
  });
});
