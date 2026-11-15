import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ballotCategories } from './ballot';
import { daisyWinnerBallot } from './ballot-definition';
import { ballotCompetitionSchemaFor } from './ballot-schema';

setupRitewayBun();
const subjects = {
  sides: ['affirmative', 'negative'],
  speakers: [],
  segments: [],
};
const points = (n: number) =>
  Object.fromEntries(ballotCategories.map((key) => [key, n]));
const competition = {
  rubricVersion: 'speaker-10@2',
  winner: 'affirmative',
  scores: { affirmative: points(4), negative: points(3) },
};
test('competitive ballot values use the real definition without written text', () => {
  const schema = ballotCompetitionSchemaFor(daisyWinnerBallot, subjects);
  assert({
    given:
      'actual winner and criterion scores on a definition that requires a reason',
    should: 'validate competitive values alone unchanged',
    actual: schema.parse(competition),
    expected: competition,
  });
  assert({
    given: 'private written content offered as competitive history',
    should: 'refuse reason, feedback and citations instead of retaining them',
    actual: ['reason', 'feedback', 'citations'].map(
      (key) =>
        schema.safeParse({
          ...competition,
          [key]: key === 'reason' ? 'Written text' : {},
        }).success,
    ),
    expected: [false, false, false],
  });
});

test('competitive history preserves the ordinary decision and score restrictions', () => {
  const definition = {
    ...daisyWinnerBallot,
    decision: {
      kind: 'winner' as const,
      lowPointWin: false,
      tie: false,
      doubleLoss: false,
    },
  };
  const schema = ballotCompetitionSchemaFor(definition, subjects);
  assert({
    given:
      'unknown winner, missing criteria, excessive points and forbidden low-point winner',
    should: 'refuse each by the same ballot rules',
    actual: [
      { ...competition, winner: 'other' },
      { ...competition, scores: { affirmative: {}, negative: points(3) } },
      {
        ...competition,
        scores: { affirmative: points(6), negative: points(3) },
      },
      {
        ...competition,
        scores: { affirmative: points(2), negative: points(4) },
      },
    ].map((value) => schema.safeParse(value).success),
    expected: [false, false, false, false],
  });
});

test('competitive score lattices start at the exact declared minimum', () => {
  const definition = {
    ...daisyWinnerBallot,
    points: {
      ...daisyWinnerBallot.points!,
      scale: { min: 0.25, max: 1.25, step: 0.1 },
      default: 0.25,
      criteria: { kind: 'holistic' as const },
    },
  };
  const schema = ballotCompetitionSchemaFor(definition, subjects);
  assert({
    given: 'a nonzero fractional minimum and decimal step',
    should: 'accept exact offset lattice values and refuse between-step values',
    actual: [0.25, 0.35, 1.25, 0.3, 0.36].map(
      (value) =>
        schema.safeParse({
          rubricVersion: 'speaker-10@2',
          winner: 'affirmative',
          scores: { affirmative: value, negative: 0.25 },
        }).success,
    ),
    expected: [true, true, true, false, false],
  });
});
