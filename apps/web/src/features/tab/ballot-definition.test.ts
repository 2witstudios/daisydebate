import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  applyBallotOption,
  ballotProblem,
  pointsScaleLabel,
  subjectTotal,
  type BallotDefinition,
} from './ballot-definition';

setupRitewayBun();

const definition: BallotDefinition = {
  version: 2,
  points: { min: 20, max: 30, step: 0.5, lowPointWin: false },
  ranks: false,
  criteria: [],
  outcomes: { winner: true, doubleLoss: true },
  written: {
    reason: 'required',
    feedback: 'optional',
    privateNote: 'optional',
  },
};
const subjects = [
  { id: 'a', name: 'Jensen', role: 'Affirmative' },
  { id: 'b', name: 'Doyle', role: 'Negative' },
];

describe('applyBallotOption', () => {
  test('each part a host can choose', () => {
    assert({
      given:
        'a choice for ranks, criteria, double loss, a written field and screening',
      should:
        'change only that part of the definition, and nothing for screening',
      actual: [
        applyBallotOption(definition, 'ranks', 'on').ranks,
        applyBallotOption(definition, 'criteria', 'grid').criteria,
        applyBallotOption(definition, 'doubleLoss', 'never').outcomes,
        applyBallotOption(definition, 'feedback', 'off').written,
        applyBallotOption(definition, 'reason', 'nonsense') === definition,
        applyBallotOption(definition, 'screening', 'release') === definition,
      ],
      expected: [
        true,
        ['Argument', 'Evidence', 'Delivery'],
        { winner: true, doubleLoss: false },
        { reason: 'required', feedback: 'off', privateNote: 'optional' },
        true,
        true,
      ],
    });
  });
});

describe('ballotProblem', () => {
  test('a winner with fewer points', () => {
    const draft = { winner: 'a', points: { a: 28.5, b: 29 } };
    assert({
      given:
        'a winner on fewer points, where low-point wins are and are not allowed, a tie, and no winner yet',
      should:
        'refuse only the low-point win the event forbids, saying whom to change',
      actual: [
        ballotProblem(definition, subjects, draft),
        ballotProblem(
          {
            ...definition,
            points: { min: 20, max: 30, step: 0.5, lowPointWin: true },
          },
          subjects,
          draft,
        ),
        ballotProblem(definition, subjects, {
          winner: 'a',
          points: { a: 29, b: 29 },
        }),
        ballotProblem(definition, subjects, {
          winner: null,
          points: draft.points,
        }),
        ballotProblem({ ...definition, points: null }, subjects, draft),
      ],
      expected: [
        "This tournament doesn't allow the winner to have fewer points. Raise Jensen or lower Doyle.",
        null,
        null,
        null,
        null,
      ],
    });
  });
});

describe('points', () => {
  test('the scale and a criteria total', () => {
    const grid = applyBallotOption(definition, 'criteria', 'grid');
    assert({
      given:
        'a scale in halves and in whole points, and a criteria grid with one score missing',
      should: 'name the scale, and add the criteria up from the scale minimum',
      actual: [
        pointsScaleLabel({ min: 20, max: 30, step: 0.5, lowPointWin: false }),
        pointsScaleLabel({ min: 50, max: 100, step: 1, lowPointWin: true }),
        subjectTotal(grid, { 'a:Argument': 25, 'a:Evidence': 26 }, 'a'),
        subjectTotal(definition, { a: 28 }, 'a'),
      ],
      expected: ['20 to 30, in halves', '50 to 100, in whole points', 71, 28],
    });
  });
});
