import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fourTeams, twoSides } from '@daisy/protocol/seats';
import { seatName, shapeLabel, sideName, sideShortName } from './seat-names';

setupRitewayBun();

const twoSided = {
  sides: twoSides,
  seats: {
    sides: { affirmative: 1, negative: 2 },
    speakers: 0,
    judges: 3,
    moderators: 0,
  },
};

test('a seat reads by the format’s own side labels', () => {
  assert({
    given: 'a two-sided format with one Aff seat, two Neg seats and a panel',
    should: 'number a seat only when its kind or side has more than one',
    actual: [
      seatName(twoSided, { kind: 'side', side: 'affirmative', slot: 0 }),
      seatName(twoSided, { kind: 'side', side: 'negative', slot: 1 }),
      seatName(twoSided, { kind: 'judge', slot: 0 }),
    ],
    expected: ['Affirmative', 'Negative 2', 'Judge 1'],
  });
  assert({
    given: 'a four-team format',
    should: 'read the declared labels and short names',
    actual: [
      sideName(fourTeams, 'closing_government'),
      sideShortName(fourTeams, 'opening_opposition'),
      shapeLabel({
        sides: fourTeams,
        seats: {
          sides: {
            opening_government: 2,
            opening_opposition: 2,
            closing_government: 2,
            closing_opposition: 2,
          },
          speakers: 0,
          judges: 1,
          moderators: 0,
        },
      }),
    ],
    expected: ['Closing Government', 'OO', '2v2v2v2'],
  });
});
