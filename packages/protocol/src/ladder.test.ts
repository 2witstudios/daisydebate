import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  daisyLaddersOf,
  divisionForSeatedDebaters,
  divisionOfAgeBand,
  ladderKey,
  ratingDivisions,
  roomLadderOf,
  roundCompetition,
  seatedDivision,
} from './ladder';
import type { RatingDivision } from './ladder';
import type { SeatRef } from './seats';

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

test('divisionForSeatedDebaters', () => {
  assert({
    given: 'no seated debater',
    should: 'leave the ladder unset until a debater sits',
    actual: divisionForSeatedDebaters([]),
    expected: 'unset',
  });
  assert({
    given: 'debaters who are all 18 and over',
    should: 'seat the Room on Open',
    actual: divisionForSeatedDebaters(['open', 'open', 'open', 'open']),
    expected: 'open',
  });
  assert({
    given: 'debaters who are all under 18',
    should: 'seat the Room on Youth',
    actual: divisionForSeatedDebaters(['youth', 'youth']),
    expected: 'youth',
  });
  assert({
    given: 'one debater on each division',
    should: 'call the seating mixed, which cannot rate',
    actual: divisionForSeatedDebaters(['youth', 'open']),
    expected: 'mixed',
  });
  assert({
    given: 'a seated debater with no division (no valid age record)',
    should: 'call the seating mixed: no ladder can hold them',
    actual: [
      divisionForSeatedDebaters([null]),
      divisionForSeatedDebaters(['open', null]),
    ],
    expected: ['mixed', 'mixed'],
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
  assert({
    given: 'a ranked Freestyle Room whose debaters are all on one division',
    should: 'freeze a ranked Round on that ladder',
    actual: [
      roundCompetition(ranked, 'open'),
      roundCompetition(ranked, 'youth'),
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
    given: 'a ranked Room whose debaters mix divisions',
    should: 'freeze a casual Round that rates no one',
    actual: roundCompetition(ranked, 'mixed'),
    expected: { competitionType: 'casual', ladder: null },
  });
  assert({
    given: 'a casual Room on any seating',
    should: 'freeze a casual Round',
    actual: roundCompetition(
      { competitionType: 'casual', formatId: 'freestyle' },
      'open',
    ),
    expected: { competitionType: 'casual', ladder: null },
  });
  assert({
    given: 'a ranked Room on a format that is no style',
    should: 'never invent a ladder',
    actual: roundCompetition(
      { competitionType: 'ranked', formatId: 'custom-thing' },
      'open',
    ),
    expected: { competitionType: 'casual', ladder: null },
  });
});

const aff: SeatRef = { kind: 'side', side: 'affirmative', slot: 0 };
const neg: SeatRef = { kind: 'side', side: 'negative', slot: 0 };
const judge: SeatRef = { kind: 'judge', slot: 0 };
const person = (
  actorId: string,
  division: RatingDivision | null,
  seat: SeatRef,
) => ({ actorId, kind: 'human' as const, division, seat });

test('seatedDivision', () => {
  assert({
    given: 'a ranked Room with only a judge seated',
    should: 'leave the ladder unset: judges never set it',
    actual: seatedDivision([person('j', 'open', judge)]),
    expected: 'unset',
  });
  assert({
    given: 'two youth debaters and an adult judge',
    should: 'seat the Room on Youth',
    actual: seatedDivision([
      person('a', 'youth', aff),
      person('b', 'youth', neg),
      person('j', 'open', judge),
    ]),
    expected: 'youth',
  });
  assert({
    given: 'a youth and an adult debater',
    should: 'call the seating mixed',
    actual: seatedDivision([
      person('a', 'youth', aff),
      person('b', 'open', neg),
    ]),
    expected: 'mixed',
  });
  assert({
    given: 'a bot on a debater seat',
    should: 'leave the bot out of the division',
    actual: seatedDivision([
      person('a', 'open', aff),
      { kind: 'bot', division: null, seat: neg },
    ]),
    expected: 'open',
  });
});

test('roomLadderOf', () => {
  const ranked = {
    competitionType: 'ranked' as const,
    launched: false,
    roundDivision: null,
    debaterDivisions: [],
  };
  assert({
    given:
      'a casual Room, an open ranked Room with none, one, and mixed debaters, and launched ranked Rooms',
    should:
      'name no ladder on casual, the seats’ ladder while open, and the Round’s once launched (mixed when it plays casual)',
    actual: [
      roomLadderOf({ ...ranked, competitionType: 'casual' }),
      roomLadderOf(ranked),
      roomLadderOf({ ...ranked, debaterDivisions: ['youth'] }),
      roomLadderOf({ ...ranked, debaterDivisions: ['youth', 'open'] }),
      roomLadderOf({ ...ranked, launched: true, roundDivision: 'open' }),
      roomLadderOf({ ...ranked, launched: true }),
    ],
    expected: [null, 'unset', 'youth', 'mixed', 'open', 'mixed'],
  });
});
