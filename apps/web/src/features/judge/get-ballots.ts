import type { Ballot } from '@daisy/protocol';
import {
  sampleAiBallot,
  sampleBallotDebaters,
  sampleJudgeBallot,
} from '../../ui/mock/judge';
import type { BallotDebaters } from './ballot';

/** A judged round's two ballots: the person who judged it and the AI judge. */
export type RoundBallots = {
  readonly debaters: BallotDebaters;
  readonly judge: Ballot;
  readonly ai: Ballot;
};

/**
 * The sample debate preview's ballot seam. `getRoundBallots` is a finished debate's stored ballots, or null
 * when no person has judged it. The debate page passes the ballots into the
 * debate view, which takes the winner from the judge's ballot, so the
 * backend reads replace these two functions. The sample is one round the
 * affirmative won, the same for every debate.
 */
export const getRoundBallots = (_debateId: string): RoundBallots | null => ({
  debaters: sampleBallotDebaters,
  judge: sampleJudgeBallot,
  ai: sampleAiBallot,
});
