import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ballotCategoryCount, ballotGroups } from './ballot-card';
import { ncfcaTimes } from './ncfca-times';

setupRitewayBun();

test('the NCFCA page prints the catalog’s own speaking order and times', () => {
  assert({
    given: 'the format catalog',
    should:
      'print Lincoln-Douglas and Team Policy in speaking order, cross-examinations as CX, with each side’s prep',
    actual: ncfcaTimes(),
    expected: [
      {
        name: 'NCFCA Lincoln-Douglas',
        speeches: 'AC 6, CX 3, NC 7, CX 3, 1AR 4, NR 6, 2AR 3',
        prepMinutes: 3,
      },
      {
        name: 'NCFCA Team Policy',
        speeches:
          '1AC 8, CX 3, 1NC 8, CX 3, 2AC 8, CX 3, 2NC 8, CX 3, 1NR 5, 1AR 5, 2NR 5, 2AR 5',
        prepMinutes: 5,
      },
    ],
  });
});

test('the coach page shows the ballot new rounds are judged on', () => {
  assert({
    given: 'the current ballot rubric',
    should: 'name its four groups and count its ten categories',
    actual: [ballotGroups().map((group) => group.name), ballotCategoryCount()],
    expected: [['Case', 'Clash', 'Cross-ex', 'Presentation'], 10],
  });
});
