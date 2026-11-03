import type { Ballot } from '@daisy/protocol';
import type { BallotDebaters } from '../../features/judge/ballot';

/**
 * Sample judge data. Every name, number and line here is invented to fill
 * the screens; none of it is a product rule.
 */

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
