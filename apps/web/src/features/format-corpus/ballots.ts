import {
  ballotCategories,
  ballotSchemaFor,
  daisyWinnerBallot,
  isLowPointWin,
  speakerTotal,
  storedBallotSchemaFor,
} from '@daisy/protocol';

/** Today's ballot: Daisy's winner ballot over the two-sided preset. */
const twoSided = {
  sides: ['affirmative', 'negative'],
  speakers: [],
  segments: [],
};
const ballotSchema = ballotSchemaFor(daisyWinnerBallot, twoSided);
const storedBallotSchema = storedBallotSchemaFor(daisyWinnerBallot, twoSided);
import type { z } from 'zod';

const scores = (
  score: number,
  categories: readonly string[] = ballotCategories,
) => Object.fromEntries(categories.map((category) => [category, score]));

const v1Categories = [
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
];

const valid = {
  rubricVersion: 'speaker-10@2',
  winner: 'affirmative',
  scores: { affirmative: scores(4), negative: scores(3) },
  reason: 'The affirmative answered the funding question.',
  feedback: {
    affirmative: 'Weigh your impacts earlier.',
    negative: 'Extend the maintenance argument.',
  },
};

const withoutKey = (value: Record<string, unknown>, key: string) =>
  Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));

/** Valid and invalid ballots, each varying one thing from a valid one. */
const ballots: readonly (readonly [string, unknown])[] = [
  ['valid', valid],
  ['no-feedback', { ...valid, feedback: {} }],
  ['one-side-feedback', { ...valid, feedback: { negative: 'Extend it.' } }],
  [
    'feedback-at-limit',
    { ...valid, feedback: { affirmative: 'f'.repeat(280) } },
  ],
  [
    'feedback-over-limit',
    { ...valid, feedback: { affirmative: 'f'.repeat(281) } },
  ],
  ['feedback-blank', { ...valid, feedback: { affirmative: '   ' } }],
  ['feedback-unknown-side', { ...valid, feedback: { judge: 'Hello.' } }],
  ['reason-at-limit', { ...valid, reason: 'r'.repeat(600) }],
  ['reason-over-limit', { ...valid, reason: 'r'.repeat(601) }],
  ['reason-blank', { ...valid, reason: ' ' }],
  ['winner-missing', withoutKey(valid, 'winner')],
  ['winner-invalid', { ...valid, winner: 'draw' }],
  [
    'low-point-win',
    { ...valid, scores: { affirmative: scores(2), negative: scores(5) } },
  ],
  [
    'score-zero',
    {
      ...valid,
      scores: { ...valid.scores, negative: { ...scores(3), delivery: 0 } },
    },
  ],
  [
    'score-six',
    {
      ...valid,
      scores: { ...valid.scores, negative: { ...scores(3), thesis: 6 } },
    },
  ],
  [
    'score-fraction',
    {
      ...valid,
      scores: { ...valid.scores, affirmative: { ...scores(4), weighing: 3.5 } },
    },
  ],
  [
    'score-category-missing',
    {
      ...valid,
      scores: {
        ...valid.scores,
        affirmative: withoutKey(scores(4), 'delivery'),
      },
    },
  ],
  [
    'score-category-extra',
    {
      ...valid,
      scores: { ...valid.scores, affirmative: { ...scores(4), style: 4 } },
    },
  ],
  ['side-missing', { ...valid, scores: { affirmative: scores(4) } }],
  ['extra-key', { ...valid, confidence: 0.9 }],
  ['rubric-unknown', { ...valid, rubricVersion: 'speaker-10@9' }],
  [
    'rubric-v1',
    {
      ...valid,
      rubricVersion: 'speaker-10@1',
      scores: {
        affirmative: scores(4, v1Categories),
        negative: scores(3, v1Categories),
      },
    },
  ],
  [
    'citations',
    {
      ...valid,
      citations: {
        affirmative: { thesis: { turn: '0.1', note: 'Public good framing.' } },
      },
    },
  ],
  [
    'citation-blank-turn',
    { ...valid, citations: { negative: { thesis: { turn: '', note: 'x' } } } },
  ],
  [
    'citation-note-over-limit',
    {
      ...valid,
      citations: {
        negative: { thesis: { turn: '1.0', note: 'n'.repeat(201) } },
      },
    },
  ],
  [
    'citation-unknown-category',
    {
      ...valid,
      citations: { negative: { style: { turn: '1.0', note: 'x' } } },
    },
  ],
];

/** An issue as the corpus records it: its path, code and limits, never its message. */
const issueOf = (issue: z.core.$ZodIssue) => ({
  path: issue.path.map(String),
  code: issue.code,
  ...('keys' in issue ? { keys: issue.keys } : {}),
  ...('minimum' in issue ? { minimum: Number(issue.minimum) } : {}),
  ...('maximum' in issue ? { maximum: Number(issue.maximum) } : {}),
});

const parsed = (schema: z.ZodType, value: unknown) => {
  const result = schema.safeParse(value);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, issues: result.error.issues.map(issueOf) };
};

/** Speaker totals and the low-point flag, for a ballot that parsed. */
const totals = (value: unknown) => {
  const result = storedBallotSchema.safeParse(value);
  if (!result.success) return null;
  const { winner, scores: sides } = result.data as {
    winner: string;
    scores: Record<'affirmative' | 'negative', Record<string, number>>;
  };
  return {
    affirmative: speakerTotal(sides.affirmative),
    negative: speakerTotal(sides.negative),
    lowPointWin: isLowPointWin(winner, sides),
  };
};

/** Every ballot case, by corpus file name. */
export const ballotCases = (): readonly (readonly [string, unknown])[] =>
  ballots.map(([name, ballot]) => [
    name,
    {
      ballot,
      write: parsed(ballotSchema, ballot),
      stored: parsed(storedBallotSchema, ballot),
      totals: totals(ballot),
    },
  ]);
