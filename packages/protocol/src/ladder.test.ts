import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  daisyLaddersOf,
  divisionOfAgeBand,
  ladderKey,
  ratingDivisions,
  roundCompetition,
} from './ladder';
import type { RatingDivision } from './ladder';

setupRitewayBun();

test('divisionOfAgeBand', () => {
  assert({
    given: 'an adult band, each band under 18 and no age record',
    should:
      'put adults on Open, every younger member on Youth and no record nowhere',
    actual: [
      divisionOfAgeBand('adult'),
      divisionOfAgeBand('16-17'),
      divisionOfAgeBand('13-15'),
      divisionOfAgeBand('under-13'),
      divisionOfAgeBand(null),
    ],
    expected: ['open', 'youth', 'youth', 'youth', null],
  });
});

test('ladderKey', () => {
  assert({
    given: 'a style and a division',
    should: 'name the one ladder they make, distinct per division',
    actual: [ladderKey('freestyle', 'open'), ladderKey('freestyle', 'youth')],
    expected: ['freestyle:open', 'freestyle:youth'],
  });
});

test('daisyLaddersOf', () => {
  assert({
    given: 'the one style',
    should: 'yield its Open and Youth ladders',
    actual: daisyLaddersOf(['freestyle']),
    expected: [
      { style: 'freestyle', division: 'open' },
      { style: 'freestyle', division: 'youth' },
    ],
  });
  assert({
    given: 'a second style added to the style list',
    should: 'yield both divisions for it too, with no other change',
    actual: daisyLaddersOf(['freestyle', 'policy'] as const).map((ladder) =>
      ladderKey(ladder.style, ladder.division),
    ),
    expected: [
      'freestyle:open',
      'freestyle:youth',
      'policy:open',
      'policy:youth',
    ],
  });
  assert({
    given: 'the division vocabulary',
    should: 'be Open then Youth',
    actual: [...ratingDivisions],
    expected: ['open', 'youth'],
  });
});

test('roundCompetition', () => {
  const ranked = { competitionType: 'ranked', formatId: 'freestyle' } as const;
  const inLobby = (division: RatingDivision) => ({ ...ranked, division });
  assert({
    given: 'a ranked Freestyle Room in each lobby',
    should: 'freeze a ranked Round on the Room’s own division',
    actual: [
      roundCompetition(inLobby('open')),
      roundCompetition(inLobby('youth')),
    ],
    expected: [
      {
        competitionType: 'ranked',
        ladder: { style: 'freestyle', division: 'open' },
      },
      {
        competitionType: 'ranked',
        ladder: { style: 'freestyle', division: 'youth' },
      },
    ],
  });
  assert({
    given: 'a casual Room',
    should: 'freeze a casual Round',
    actual: roundCompetition({
      competitionType: 'casual',
      formatId: 'freestyle',
      division: 'open',
    }),
    expected: { competitionType: 'casual', ladder: null },
  });
  assert({
    given: 'a ranked Room on a format that is no style',
    should: 'never invent a ladder',
    actual: roundCompetition({
      competitionType: 'ranked',
      formatId: 'custom-thing',
      division: 'open',
    }),
    expected: { competitionType: 'casual', ladder: null },
  });
});

