import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { BallotDefinition } from './ballot-definition';
import {
  applyBallotOption,
  ballotProblem,
  pointsScaleLabel,
  subjectTotal,
} from './ballot-rules';

setupRitewayBun();

const definition: BallotDefinition = {
  key: 'sample-varsity',
  revision: 2,
  decision: {
    kind: 'winner',
    lowPointWin: false,
    tie: false,
    doubleLoss: true,
  },
  points: {
    per: 'side',
    scale: { min: 20, max: 30, step: 0.5 },
    default: 20,
    weights: null,
    criteria: { kind: 'holistic' },
  },
  speakerRanks: false,
  written: {
    reason: { required: true, max: 5000 },
    feedback: { required: false, max: 5000 },
  },
};
const subjects = [
  { id: 'a', name: 'Jensen', role: 'Affirmative' },
  { id: 'b', name: 'Doyle', role: 'Negative' },
];

describe('applyBallotOption', () => {
  test('screening never changes the authored ballot', () => {
    assert({
      given: 'a release screening choice',
      should: 'retain the exact canonical definition and authored criteria',
      actual: applyBallotOption(definition, 'screening', 'off') === definition,
      expected: true,
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
            decision: {
              kind: 'winner',
              lowPointWin: true,
              tie: false,
              doubleLoss: true,
            },
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
    const grid: BallotDefinition = {
      ...definition,
      points: {
        ...definition.points!,
        criteria: {
          kind: 'grid',
          groups: [
            {
              id: 'overall',
              name: 'Overall',
              categories: [
                {
                  id: 'argument',
                  name: 'Argument',
                  rewards: 'Supported reasoning',
                  anchors: ['Unsupported', 'Supported'],
                },
                {
                  id: 'evidence',
                  name: 'Evidence',
                  rewards: 'Relevant support',
                  anchors: ['Absent', 'Relevant'],
                },
                {
                  id: 'delivery',
                  name: 'Delivery',
                  rewards: 'Clear speech',
                  anchors: ['Unclear', 'Clear'],
                },
              ],
            },
          ],
        },
      },
    };
    assert({
      given:
        'a scale in halves and in whole points, and a criteria grid with one score missing and an explicit default',
      should:
        'name the scale, and add the criteria up from its authored default',
      actual: [
        pointsScaleLabel(definition.points!),
        pointsScaleLabel({
          ...definition.points!,
          scale: { min: 50, max: 100, step: 1 },
        }),
        subjectTotal(grid, { 'a:argument': 25, 'a:evidence': 26 }, 'a'),
        subjectTotal(definition, { a: 28 }, 'a'),
      ],
      expected: ['20 to 30, in halves', '50 to 100, in whole points', 71, 28],
    });
  });
});
