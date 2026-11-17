import { assert, setupRitewayBun, test } from 'riteway/bun';
import { seatsTwoTeams, sidesSwappable } from './seat-draw';
import { fourTeams, twoSides } from './seats';

setupRitewayBun();

const seating = (
  sides: readonly { readonly key: string }[],
  counts: Readonly<Record<string, number>>,
  speakers = 0,
) => ({
  sides,
  seats: { sides: counts, speakers, judges: 1, moderators: 0 },
});

const oneVsOne = seating(twoSides, { affirmative: 1, negative: 1 });
const unequal = seating(twoSides, { affirmative: 2, negative: 3 });
const fourSides = seating(
  fourTeams,
  Object.fromEntries(fourTeams.map((side) => [side.key, 2])),
);
const speakersOnly = seating([], {}, 6);
const sidesAndSpeakers = seating(twoSides, { affirmative: 1, negative: 1 }, 2);

test('seatsTwoTeams (ADR 0145, TAB-6.2)', () => {
  assert({
    given:
      'the two-sided preset, unequal teams, four sides, speakers alone, and two sides with speakers',
    should:
      'seat two teams only for the two-sided preset with no unsided speakers',
    actual: [oneVsOne, unequal, fourSides, speakersOnly, sidesAndSpeakers].map(
      seatsTwoTeams,
    ),
    expected: [true, true, false, false, false],
  });
});

test('sidesSwappable (ADR 0145)', () => {
  assert({
    given: 'the same five seatings',
    should: 'let only two equal teams swap or flip their sides',
    actual: [oneVsOne, unequal, fourSides, speakersOnly, sidesAndSpeakers].map(
      sidesSwappable,
    ),
    expected: [true, false, false, false, false],
  });
});
