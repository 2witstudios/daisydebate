import { z } from 'zod';
import { debateSideSchema, debateSides } from './primitives';

/**
 * The speaker rubric every ballot scores against, human or AI. Ten
 * categories in four groups; each debater gets 1–5 in each. The anchors say
 * what a 1, a 3 and a 5 look like; 2 and 4 sit between them. The version is
 * stored with every ballot, so a later rubric never re-reads an old one.
 */
export const ballotRubricVersion = 'speaker-10@1';

export const ballotRubric = [
  {
    id: 'construction',
    name: 'Construction',
    categories: [
      {
        id: 'thesis',
        name: 'Thesis',
        rewards: 'One clear claim carried through',
        anchors: [
          'No central claim',
          'Claim stated, drifts',
          'Every speech serves one claim',
        ],
      },
      {
        id: 'framework',
        name: 'Framework',
        rewards: 'Set the standard and won it',
        anchors: [
          'No standard offered',
          'Standard offered, not defended',
          'Set the terms the round was judged on',
        ],
      },
      {
        id: 'analysis',
        name: 'Analysis',
        rewards: 'Warranted why, not asserted',
        anchors: [
          'Assertions only, or invented evidence',
          'Some warrants and examples',
          'Every claim warranted, examples accurate',
        ],
      },
    ],
  },
  {
    id: 'clash',
    name: 'Clash',
    categories: [
      {
        id: 'refutation',
        name: 'Refutation',
        rewards: 'Answered theirs, dropped nothing',
        anchors: [
          'Ignored the opponent',
          'Answered some, dropped some',
          'Answered every key argument, extended the answers',
        ],
      },
      {
        id: 'impact',
        name: 'Impact',
        rewards: 'Said why each argument matters',
        anchors: [
          'No stakes',
          'Stakes stated, not developed',
          'Clear magnitude, likelihood and timeframe',
        ],
      },
      {
        id: 'weighing',
        name: 'Weighing',
        rewards: 'Compared: why mine outweighs',
        anchors: [
          'No comparison',
          'Asserted “we outweigh”',
          'Explicit comparison on the opponent’s terms',
        ],
      },
    ],
  },
  {
    id: 'cross-ex',
    name: 'Cross-ex',
    categories: [
      {
        id: 'questioning',
        name: 'Questioning',
        rewards: 'Questions that set up arguments',
        anchors: [
          'Aimless, or speeches as questions',
          'Some useful concessions',
          'Won concessions used later',
        ],
      },
      {
        id: 'answering',
        name: 'Answering',
        rewards: 'Direct, honest, no evasion',
        anchors: [
          'Evasive or stalling',
          'Mostly direct',
          'Concise, honest, kept position',
        ],
      },
    ],
  },
  {
    id: 'presentation',
    name: 'Presentation',
    categories: [
      {
        id: 'organization',
        name: 'Organization',
        rewards: 'Signposted, easy to flow',
        anchors: [
          'Impossible to follow',
          'Mostly followable',
          'Roadmap, signposts, clean flow',
        ],
      },
      {
        id: 'delivery',
        name: 'Delivery',
        rewards: 'Clear, paced, persuasive',
        anchors: [
          'Unclear or rushed',
          'Understandable',
          'Clear, confident, used the time',
        ],
      },
    ],
  },
] as const;

/** The ten category ids, in rubric order. */
export const ballotCategories = [
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
] as const;
export type BallotCategory = (typeof ballotCategories)[number];

/** The score every category starts at on a new ballot. */
export const ballotDefaultScore = 3;
export const ballotScoreMax = 5;
const ballotReasonMax = 600;
const ballotFeedbackMax = 280;

const scoreSchema = z.int().min(1).max(ballotScoreMax);
const categorySchema = z.enum(ballotCategories);
const sideScoresSchema = z.record(categorySchema, scoreSchema);
const citationSchema = z.strictObject({
  turn: z.string().trim().min(1).max(8),
  note: z.string().trim().min(1).max(200),
});

/**
 * One judge's ballot. The judge picks a winner (there are no draws), scores
 * every category for both sides, and gives a reason both debaters see.
 * Feedback for each debater is optional. An AI ballot adds the turn behind
 * each score as citations.
 */
export const ballotSchema = z.strictObject({
  rubricVersion: z.literal(ballotRubricVersion),
  winner: debateSideSchema,
  scores: z.record(debateSideSchema, sideScoresSchema),
  reason: z.string().trim().min(1).max(ballotReasonMax),
  feedback: z.partialRecord(
    debateSideSchema,
    z.string().trim().min(1).max(ballotFeedbackMax),
  ),
  citations: z
    .partialRecord(
      debateSideSchema,
      z.partialRecord(categorySchema, citationSchema),
    )
    .optional(),
});
export type Ballot = z.infer<typeof ballotSchema>;

/** One side's speaker score: the sum of its ten category scores, out of 50. */
export const speakerTotal = (
  scores: Readonly<Record<BallotCategory, number>>,
): number =>
  ballotCategories.reduce((sum, category) => sum + scores[category], 0);

/** True when the winner's speaker score is lower than the loser's. */
export const isLowPointWin = (
  winner: (typeof debateSides)[number],
  scores: Readonly<
    Record<
      (typeof debateSides)[number],
      Readonly<Record<BallotCategory, number>>
    >
  >,
): boolean => {
  const loser = debateSides.find((side) => side !== winner) ?? winner;
  return speakerTotal(scores[winner]) < speakerTotal(scores[loser]);
};

export const ballotLimits = {
  reason: ballotReasonMax,
  feedback: ballotFeedbackMax,
} as const;
