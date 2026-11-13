import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  ballotCategories,
  ballotRubric,
  ballotRubrics,
  ballotRubricVersion,
  ballotSchema,
  isLowPointWin,
  rubricCategories,
  speakerTotal,
  storedBallotSchema,
  type BallotCategory,
} from './ballot';

setupRitewayBun();

const allAt = (score: number): Record<BallotCategory, number> =>
  Object.fromEntries(ballotCategories.map((c) => [c, score])) as Record<
    BallotCategory,
    number
  >;

const valid = {
  rubricVersion: 'speaker-10@2',
  winner: 'affirmative',
  scores: { affirmative: allAt(4), negative: allAt(3) },
  reason: 'The affirmative weighed exclusion against a fine.',
  feedback: { negative: 'Weigh liberty against exclusion.' },
};

describe('ballotRubric', () => {
  test('categories', () => {
    assert({
      given: 'the rubric groups',
      should: 'list the same ten categories, in order, as the category ids',
      actual: ballotRubric.flatMap((group) =>
        group.categories.map((category) => category.id),
      ),
      expected: [...ballotCategories],
    });
  });

  test('anchors', () => {
    assert({
      given: 'every category',
      should: 'carry three anchors: a 1, a 3 and a 5',
      actual: ballotRubric.every((group) =>
        group.categories.every((category) => category.anchors.length === 3),
      ),
      expected: true,
    });
  });
});

describe('ballotRubrics', () => {
  test('the current rubric', () => {
    assert({
      given: 'the current rubric version',
      should:
        'be the coherency rubric, grouped as Case, Clash, Cross-ex and Presentation',
      actual: [
        ballotRubricVersion,
        ballotRubric.map((group) => group.name),
        rubricCategories(ballotRubricVersion),
      ],
      expected: [
        'speaker-10@2',
        ['Case', 'Clash', 'Cross-ex', 'Presentation'],
        [
          'thesis',
          'burdens',
          'warrants',
          'coherence',
          'refutation',
          'weighing',
          'questioning',
          'answering',
          'organization',
          'delivery',
        ],
      ],
    });
  });

  test('history', () => {
    assert({
      given: 'the first rubric',
      should: 'stay readable with its own ten categories',
      actual: rubricCategories('speaker-10@1'),
      expected: [
        'thesis',
        'framework',
        'analysis',
        'refutation',
        'impact',
        'weighing',
        'questioning',
        'answering',
        'organization',
        'delivery',
      ],
    });
  });

  test('anchors everywhere', () => {
    assert({
      given: 'every category of every version',
      should: 'carry three anchors',
      actual: Object.values(ballotRubrics).every((rubric) =>
        rubric.every((group) =>
          group.categories.every((category) => category.anchors.length === 3),
        ),
      ),
      expected: true,
    });
  });
});

describe('ballotSchema', () => {
  test('a valid ballot', () => {
    assert({
      given: 'a winner, every score, a reason and feedback for one side',
      should: 'accept it',
      actual: ballotSchema.safeParse(valid).success,
      expected: true,
    });
  });

  test('refusals', () => {
    const refused = [
      { winner: 'draw' },
      {
        scores: { affirmative: allAt(4), negative: { ...allAt(3), thesis: 6 } },
      },
      { scores: { affirmative: allAt(4), negative: { thesis: 3 } } },
      { reason: '   ' },
      { reason: 'x'.repeat(601) },
      { feedback: { affirmative: 'x'.repeat(281) } },
      { rubricVersion: 'speaker-9@1' },
      { rubricVersion: 'speaker-10@1' },
      { extra: true },
    ].map((change) => ballotSchema.safeParse({ ...valid, ...change }).success);
    assert({
      given:
        'a draw, a score of 6, a missing category, an empty or long reason, long feedback, an unknown rubric, the previous rubric and an unknown field',
      should: 'refuse each',
      actual: refused,
      expected: refused.map(() => false),
    });
  });

  test('citations', () => {
    assert({
      given: 'an AI ballot citing the turn behind a score',
      should: 'accept it',
      actual: ballotSchema.safeParse({
        ...valid,
        citations: {
          negative: { weighing: { turn: 'NR', note: 'No comparison' } },
        },
      }).success,
      expected: true,
    });
  });
});

describe('storedBallotSchema', () => {
  const v1Scores = (score: number) =>
    Object.fromEntries(rubricCategories('speaker-10@1').map((c) => [c, score]));
  const old = {
    ...valid,
    rubricVersion: 'speaker-10@1',
    scores: { affirmative: v1Scores(4), negative: v1Scores(3) },
  };

  test('both versions', () => {
    assert({
      given: 'a current ballot and a ballot written on speaker-10@1',
      should: 'read each on its own categories',
      actual: [
        storedBallotSchema.safeParse(valid).success,
        storedBallotSchema.safeParse(old).success,
      ],
      expected: [true, true],
    });
  });

  test('mixed versions', () => {
    assert({
      given:
        'speaker-10@1 scores labelled as the current version, and the reverse',
      should: 'refuse both',
      actual: [
        storedBallotSchema.safeParse({ ...old, rubricVersion: 'speaker-10@2' })
          .success,
        storedBallotSchema.safeParse({
          ...valid,
          rubricVersion: 'speaker-10@1',
        }).success,
      ],
      expected: [false, false],
    });
  });

  test('old totals', () => {
    assert({
      given: 'a speaker-10@1 side scored 4 everywhere',
      should: 'total 40',
      actual: speakerTotal(v1Scores(4)),
      expected: 40,
    });
  });
});

describe('speakerTotal', () => {
  test('sum', () => {
    assert({
      given: 'ten scores of 3',
      should: 'total 30',
      actual: speakerTotal(allAt(3)),
      expected: 30,
    });
  });
});

describe('isLowPointWin', () => {
  test('winner scored lower', () => {
    const scores = { affirmative: allAt(3), negative: allAt(4) };
    assert({
      given: 'a winner whose total is lower than the loser’s',
      should: 'be a low-point win, and not when the other side wins',
      actual: [
        isLowPointWin('affirmative', scores),
        isLowPointWin('negative', scores),
      ],
      expected: [true, false],
    });
  });

  test('level totals', () => {
    assert({
      given: 'equal totals',
      should: 'not be a low-point win',
      actual: isLowPointWin('affirmative', {
        affirmative: allAt(3),
        negative: allAt(3),
      }),
      expected: false,
    });
  });
});
