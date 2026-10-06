import type { Ballot } from '@daisy/protocol';
import {
  sampleAiBallot,
  sampleBallotDebaters,
  sampleJudgeBallot,
} from '../../ui/mock/judge';
import type { Outcome } from '../debates/state';
import type { BallotDebaters } from './ballot';

/** A judged round's two ballots: the person who judged it and the AI judge. */
export type RoundBallots = {
  readonly debaters: BallotDebaters;
  readonly judge: Ballot;
  readonly ai: Ballot;
};

/**
 * The ballot's data seams: who debated, and a finished round's ballots. The
 * backend reads of the debate's seats and its stored ballots replace these
 * functions and nothing else. The sample backs an affirmative win only.
 */
export const getBallotDebaters = (): BallotDebaters => sampleBallotDebaters;

export const getRoundBallots = (winner: Outcome): RoundBallots | null =>
  winner === sampleJudgeBallot.winner
    ? {
        debaters: sampleBallotDebaters,
        judge: sampleJudgeBallot,
        ai: sampleAiBallot,
      }
    : null;
