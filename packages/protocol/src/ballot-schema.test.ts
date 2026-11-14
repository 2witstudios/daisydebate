import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { z } from 'zod';
import { ballotCategories } from './ballot';
import {
  ballotDefinitionSchema,
  daisyBallotDefinitions,
  daisyWinnerBallot,
  type BallotDefinition,
  type BallotSubjects,
} from './ballot-definition';
import { ballotSchemaFor } from './ballot-schema';

setupRitewayBun();

const twoSided: BallotSubjects = {
  sides: ['affirmative', 'negative'],
  speakers: [],
  segments: [],
};

/**
 * The ballot schema Daisy wrote before ballot definitions (TAB-6.1's
 * baseline), restated here so the definition's schema can be held to it.
 */
const baseline = (() => {
  const side = z.enum(['affirmative', 'negative']);
  const citation = z.strictObject({
    turn: z.string().trim().min(1).max(8),
    note: z.string().trim().min(1).max(200),
  });
  const category = z.enum(ballotCategories);
  return z.strictObject({
    rubricVersion: z.literal('speaker-10@2'),
    winner: side,
    reason: z.string().trim().min(1).max(600),
    feedback: z.partialRecord(side, z.string().trim().min(1).max(280)),
    scores: z.record(side, z.record(category, z.int().min(1).max(5))),
    citations: z
      .partialRecord(side, z.partialRecord(category, citation))
      .optional(),
  });
})();

const issuePaths = (schema: z.ZodType, value: unknown) =>
  schema.safeParse(value).error?.issues.map((issue) => issue.path.join('.')) ??
  [];

const scoresAt = (score: number) =>
  Object.fromEntries(ballotCategories.map((category) => [category, score]));

describe('ballotSchemaFor speaker-10@2 over two sides', () => {
  const schema = ballotSchemaFor(daisyWinnerBallot, twoSided);

  test('is the baseline ballot schema on the wire', () => {
    assert({
      given: 'the AI wire derivation of both schemas',
      should: 'produce the identical JSON Schema',
      actual: z.toJSONSchema(schema.omit({ citations: true }), { io: 'input' }),
      expected: z.toJSONSchema(baseline.omit({ citations: true }), {
        io: 'input',
      }),
    });
  });

  test('accepts and refuses each ballot variant as the baseline does', () => {
    const valid = {
      rubricVersion: 'speaker-10@2',
      winner: 'affirmative',
      scores: { affirmative: scoresAt(4), negative: scoresAt(3) },
      reason: 'The affirmative answered the funding question.',
      feedback: { negative: 'Extend the maintenance argument.' },
    };
    const variants = [
      valid,
      { ...valid, feedback: {} },
      { ...valid, feedback: { judge: 'Hello.' } },
      { ...valid, feedback: { affirmative: 'f'.repeat(281) } },
      { ...valid, reason: ' ' },
      { ...valid, winner: 'draw' },
      { ...valid, scores: { affirmative: scoresAt(2), negative: scoresAt(5) } },
      { ...valid, scores: { ...valid.scores, negative: scoresAt(6) } },
      {
        ...valid,
        scores: {
          ...valid.scores,
          negative: { ...scoresAt(3), weighing: 3.5 },
        },
      },
      { ...valid, scores: { affirmative: scoresAt(4) } },
      { ...valid, confidence: 0.9 },
      { ...valid, rubricVersion: 'speaker-10@1' },
      {
        ...valid,
        citations: { negative: { thesis: { turn: '1.0', note: 'x' } } },
      },
      {
        ...valid,
        citations: { negative: { style: { turn: '1.0', note: 'x' } } },
      },
    ];
    assert({
      given: 'a valid ballot and one variation of each field',
      should: 'accept and refuse each at the same paths as the baseline',
      actual: variants.map((ballot) => issuePaths(schema, ballot)),
      expected: variants.map((ballot) => issuePaths(baseline, ballot)),
    });
  });
});

const ranked = (of: 'sides' | 'speakers', ties: boolean): BallotDefinition => ({
  ...daisyBallotDefinitions['rank-sides@1'],
  key: `rank-${of}`,
  decision: { kind: 'ranking', of, ties },
});

describe('ballotSchemaFor rankings', () => {
  const sides = { ...twoSided, sides: ['og', 'oo', 'cg', 'co'] };
  const schema = ballotSchemaFor(ranked('sides', false), sides);
  const ballot = {
    rubricVersion: 'rank-sides@1',
    ranking: [['og'], ['cg'], ['oo'], ['co']],
    reason: 'Opening government carried the round.',
    feedback: {},
  };

  test('accepts every subject placed once', () => {
    assert({
      given: 'four teams in four places',
      should: 'accept the ranking',
      actual: issuePaths(schema, ballot),
      expected: [],
    });
  });

  test('refuses a missing subject and a shared place where ties are not allowed', () => {
    assert({
      given: 'a team left out, then two teams sharing a place',
      should: 'refuse the ranking field each time',
      actual: [
        issuePaths(schema, { ...ballot, ranking: [['og'], ['cg'], ['oo']] }),
        issuePaths(schema, {
          ...ballot,
          ranking: [['og', 'cg'], ['oo'], ['co']],
        }),
      ],
      expected: [['ranking'], ['ranking']],
    });
  });

  test('accepts a shared place where ties are allowed', () => {
    assert({
      given: 'a tying ranking definition',
      should: 'accept two teams sharing a place',
      actual: issuePaths(ballotSchemaFor(ranked('sides', true), sides), {
        ...ballot,
        ranking: [['og', 'cg'], ['oo'], ['co']],
      }),
      expected: [],
    });
  });
});

describe('ballotSchemaFor points', () => {
  const holistic = (
    scale: { min: number; max: number; step: number },
    weights: Record<string, number> | null = null,
    per: 'side' | 'speech' = 'side',
  ): BallotDefinition => ({
    ...daisyWinnerBallot,
    key: 'custom',
    revision: 1,
    points: {
      per,
      scale,
      default: scale.min,
      criteria: { kind: 'holistic' },
      weights,
    },
  });
  const winnerBallot = {
    rubricVersion: 'custom@1',
    winner: 'affirmative',
    reason: 'Clearer weighing.',
    feedback: {},
  };

  test('takes half-point steps and refuses a step between them', () => {
    const schema = ballotSchemaFor(
      holistic({ min: 70, max: 80, step: 0.5 }),
      twoSided,
    );
    assert({
      given: 'a 70-80 scale in half points',
      should: 'accept 75.5 and refuse 75.25 at that subject',
      actual: [
        issuePaths(schema, {
          ...winnerBallot,
          scores: { affirmative: 75.5, negative: 74 },
        }),
        issuePaths(schema, {
          ...winnerBallot,
          scores: { affirmative: 75.25, negative: 74 },
        }),
      ],
      expected: [[], ['scores.affirmative']],
    });
  });

  test('scores a criteria grid per subject', () => {
    const schema = ballotSchemaFor(daisyWinnerBallot, twoSided);
    assert({
      given: 'a grid missing a criterion for one side',
      should: 'refuse at that side',
      actual: issuePaths(schema, {
        ...winnerBallot,
        rubricVersion: 'speaker-10@2',
        scores: {
          affirmative: scoresAt(4),
          negative: { ...scoresAt(3), delivery: undefined },
        },
      }),
      expected: ['scores.negative.delivery'],
    });
  });

  test('weighs a reply speech on half the scale', () => {
    const schema = ballotSchemaFor(
      holistic({ min: 1, max: 10, step: 1 }, { R: 0.5 }, 'speech'),
      { ...twoSided, segments: ['C', 'R'] },
    );
    const ballot = (reply: number) => ({
      ...winnerBallot,
      scores: { C: 8, R: reply },
    });
    assert({
      given: 'a reply weighted at half on a 1-10 scale',
      should: 'accept 4.5 for the reply and refuse 6',
      actual: [issuePaths(schema, ballot(4.5)), issuePaths(schema, ballot(6))],
      expected: [[], ['scores.R']],
    });
  });

  test('refuses a low-point win where the definition forbids it', () => {
    const schema = ballotSchemaFor(
      {
        ...holistic({ min: 1, max: 30, step: 1 }),
        decision: {
          kind: 'winner',
          lowPointWin: false,
          tie: false,
          doubleLoss: false,
        },
      },
      twoSided,
    );
    assert({
      given: 'a winner with fewer points than the loser',
      should: 'refuse at the winner',
      actual: issuePaths(schema, {
        ...winnerBallot,
        scores: { affirmative: 20, negative: 25 },
      }),
      expected: ['winner'],
    });
  });
});

describe('ballotSchemaFor tie and double loss', () => {
  const schema = ballotSchemaFor(
    {
      ...daisyWinnerBallot,
      key: 'custom',
      revision: 1,
      points: null,
      decision: {
        kind: 'winner',
        lowPointWin: true,
        tie: true,
        doubleLoss: true,
      },
    },
    twoSided,
  );
  const ballot = {
    rubricVersion: 'custom@1',
    reason: 'Neither side carried it.',
    feedback: {},
  };

  test('accepts a tie and a double loss naming no winner', () => {
    assert({
      given: 'a tie, a double loss and a win',
      should: 'accept each with a winner exactly on the win',
      actual: [
        issuePaths(schema, { ...ballot, decision: 'tie', winner: null }),
        issuePaths(schema, {
          ...ballot,
          decision: 'double_loss',
          winner: null,
        }),
        issuePaths(schema, { ...ballot, decision: 'win', winner: 'negative' }),
      ],
      expected: [[], [], []],
    });
  });

  test('refuses a tie naming a winner and a win naming none', () => {
    assert({
      given: 'a tie with a winner, then a win without one',
      should: 'refuse at the winner',
      actual: [
        issuePaths(schema, { ...ballot, decision: 'tie', winner: 'negative' }),
        issuePaths(schema, { ...ballot, decision: 'win', winner: null }),
      ],
      expected: [['winner'], ['winner']],
    });
  });

  test('refuses a decision the definition does not offer', () => {
    assert({
      given: 'a speaker-10 ballot claiming a tie',
      should: 'refuse the unknown decision field',
      actual: issuePaths(ballotSchemaFor(daisyWinnerBallot, twoSided), {
        ...ballot,
        rubricVersion: 'speaker-10@2',
        decision: 'tie',
        winner: 'affirmative',
        scores: { affirmative: scoresAt(3), negative: scoresAt(3) },
      }),
      expected: [''],
    });
  });
});

describe('daisyBallotDefinitions', () => {
  test('every Daisy definition is a valid ballot definition', () => {
    assert({
      given: "Daisy's catalogue of ballot definitions",
      should: 'each parse under the definition schema a Round freezes',
      actual: Object.values(daisyBallotDefinitions).map(
        (definition) => ballotDefinitionSchema.safeParse(definition).success,
      ),
      expected: Object.values(daisyBallotDefinitions).map(() => true),
    });
  });
});
