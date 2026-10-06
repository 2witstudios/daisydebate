import type { Ballot } from '@daisy/protocol';
import type { BallotDebaters } from '../../features/judge/ballot';
import type { PoolStatus } from '../../features/judge/flow';
import type { JudgeRating } from '../../features/judge/rating';
import type { JudgeResource } from '../../features/judge/resources';

/**
 * Sample judge data. Every name, number and line here is invented to fill
 * the screens; none of it is a product rule.
 */

/** A new judge: provisional, seven ballots into the sample threshold. */
export const sampleJudgeRating: JudgeRating = {
  season: 'Sample season',
  status: 'provisional',
  rating: 1388,
  ballotsWithFeedback: 7,
  threshold: 15,
  series: [1350, 1362, 1358, 1371, 1380, 1376, 1388],
  recent: [
    {
      id: 'ballot-3',
      debateLabel: 'Debate 214',
      daysAgo: 3,
      decision: 'neg',
      helpful: 2,
      answered: 3,
      comment: 'Clear, and it tied the decision to the last turn.',
      review: null,
      delta: 6,
    },
    {
      id: 'ballot-2',
      debateLabel: 'Debate 198',
      daysAgo: 8,
      decision: 'aff',
      helpful: 3,
      answered: 3,
      comment: null,
      review: null,
      delta: 8,
    },
    {
      id: 'ballot-1',
      debateLabel: 'Debate 176',
      daysAgo: 13,
      decision: 'aff',
      helpful: 1,
      answered: 3,
      comment: 'Hard to tell which argument decided it.',
      review: null,
      delta: -4,
    },
  ],
};

export const sampleResources: readonly JudgeResource[] = [
  {
    kind: 'guide',
    title: 'Judging guide',
    blurb:
      'What each turn does, how to weigh a debate, and the mistakes judges make most often.',
    meta: '[12 min] read',
    cta: 'Read the guide',
    neededToQualify: false,
    onHub: true,
  },
  {
    kind: 'criteria',
    title: 'The ballot, criterion by criterion',
    blurb:
      'What argument, refutation, evidence and clarity mean, and how to score each side.',
    meta: '[8 min] read',
    cta: 'Read the criteria',
    neededToQualify: false,
    onHub: false,
  },
  {
    kind: 'examples',
    title: 'Example ballots and reasons',
    blurb:
      'Annotated ballots with notes on what makes a reason for decision clear, fair and complete.',
    meta: '[6] annotated examples',
    cta: 'See the examples',
    neededToQualify: false,
    onHub: true,
  },
  {
    kind: 'conflicts',
    title: 'Conflicts and conduct',
    blurb:
      'When to step aside, what you may and may not share, and how reviews work.',
    meta: '[5 min] read',
    cta: 'Read the policy',
    neededToQualify: false,
    onHub: false,
  },
  {
    kind: 'practice',
    title: 'Practice judging',
    blurb:
      'Judge a recorded debate, then compare your ballot with a reference panel. Practice never changes your rating.',
    meta: '[6] recorded debates',
    cta: 'Start practice',
    neededToQualify: true,
    onHub: true,
  },
  {
    kind: 'rating',
    title: 'How judge rating works',
    blurb:
      'What moves your rating, what only gives context, and how provisional becomes established.',
    meta: '[4 min] read',
    cta: 'Read how it works',
    neededToQualify: false,
    onHub: true,
  },
];

/** Sample matchmaking: 14 seconds in the pool, a two minute offer window. */
export const samplePoolStatus: PoolStatus = {
  waitedSeconds: 14,
  offerWindowSeconds: 120,
};

/** The two debaters every sample ballot names. */
export const sampleBallotDebaters: BallotDebaters = {
  affirmative: { name: 'Maya Singh' },
  negative: { name: 'Daniel Kim' },
};

/** A person's sample ballot for a round the affirmative won. */
export const sampleJudgeBallot: Ballot = {
  rubricVersion: 'speaker-10@1',
  winner: 'affirmative',
  scores: {
    affirmative: {
      thesis: 4,
      framework: 4,
      analysis: 3,
      refutation: 3,
      impact: 4,
      weighing: 3,
      questioning: 4,
      answering: 3,
      organization: 4,
      delivery: 4,
    },
    negative: {
      thesis: 3,
      framework: 4,
      analysis: 4,
      refutation: 4,
      impact: 3,
      weighing: 2,
      questioning: 3,
      answering: 4,
      organization: 3,
      delivery: 3,
    },
  },
  reason:
    'The affirmative tied the burden of proof to the resolution and weighed it in the last speech; the negative never compared its harm with theirs.',
  feedback: {
    affirmative: 'Answer every argument in your first rebuttal, even briefly.',
    negative: 'Say why your impact outweighs theirs, not only that it matters.',
  },
};

/** The AI judge's sample ballot for the same round, citing a turn per score. */
export const sampleAiBallot: Ballot = {
  rubricVersion: 'speaker-10@1',
  winner: 'affirmative',
  scores: {
    affirmative: {
      thesis: 5,
      framework: 4,
      analysis: 4,
      refutation: 3,
      impact: 4,
      weighing: 5,
      questioning: 4,
      answering: 3,
      organization: 4,
      delivery: 4,
    },
    negative: {
      thesis: 3,
      framework: 4,
      analysis: 4,
      refutation: 4,
      impact: 3,
      weighing: 2,
      questioning: 3,
      answering: 4,
      organization: 3,
      delivery: 4,
    },
  },
  reason:
    'Both sides set a standard. The affirmative won it in the 2AR by weighing exclusion against a small fine, and the negative never compared the two.',
  feedback: {
    affirmative:
      'The dropped liberty argument in the 1AR nearly cost you the round.',
    negative: 'In the NR, weigh liberty against exclusion directly.',
  },
  citations: {
    affirmative: {
      thesis: { turn: 'AC', note: 'One claim carried into every speech' },
      weighing: {
        turn: '2AR',
        note: 'A fine against decades of excluded voters',
      },
      refutation: { turn: '1AR', note: 'Dropped the second liberty argument' },
    },
    negative: {
      weighing: { turn: 'NR', note: 'No comparison with exclusion' },
      refutation: { turn: 'NR', note: 'Answered both contentions directly' },
    },
  },
};
