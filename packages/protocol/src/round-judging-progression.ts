import type { Ballot } from './ballot-schema';
import type { CaseMap } from './case-map';
import type {
  JudgingStage,
  JudgingStageInput,
  JudgingAttemptOutcome,
} from './round-judging-attempt';

/** Named persisted facts used by the judging application's progression. */
export type JudgingStageFacts = {
  readonly pendingBallot: Ballot | null;
  readonly firstBallot: Ballot | null;
  readonly firstBallotFailed: boolean;
  readonly caseMap: CaseMap | null;
};
export type JudgingProgress =
  | { readonly kind: 'ballot_held'; readonly ballot: Ballot }
  | { readonly kind: 'stage_due'; readonly due: JudgingStageInput };

/** ADR0125: the first pass has one try, the final always reads its stored map. */
export function judgingProgress(job: JudgingStageFacts): JudgingProgress {
  if (job.pendingBallot)
    return { kind: 'ballot_held', ballot: job.pendingBallot };
  if (!job.firstBallot && !job.firstBallotFailed)
    return { kind: 'stage_due', due: { stage: 'first' } };
  return {
    kind: 'stage_due',
    due: job.caseMap
      ? { stage: 'final', caseMap: job.caseMap }
      : { stage: 'map' },
  };
}
export function firstPassLost(
  job: Pick<JudgingStageFacts, 'firstBallot' | 'firstBallotFailed'>,
  priorFirstAttempt: { readonly outcome: JudgingAttemptOutcome } | undefined,
): boolean {
  return (
    !job.firstBallot &&
    !job.firstBallotFailed &&
    priorFirstAttempt?.outcome === 'dispatched'
  );
}
export type JudgingProgressionRequest = {
  readonly facts: JudgingStageFacts;
} & (
  | { readonly kind: 'inspect' }
  | {
      readonly kind: 'dispatch' | 'record' | 'failure';
      readonly stage: JudgingStage;
    }
  | {
      readonly kind: 'takeover';
      readonly priorFirstAttempt:
        { readonly outcome: JudgingAttemptOutcome } | undefined;
    }
);
export type JudgingProgressionDecision = {
  readonly progress: JudgingProgress;
  readonly spendFirstPass: boolean;
};
