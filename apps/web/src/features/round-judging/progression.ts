import { createAppError } from '@daisy/errors';
import {
  judgingProgress,
  firstPassLost,
} from '@daisy/protocol/round-judging-progression';
import type { JudgingStage } from '@daisy/protocol/round-judging-attempt';
import type { JudgingProgression } from '@daisy/db/round-judging-jobs';

/** A dispatch or stage record must be the one the job needs. */
export function requireNextStage(
  facts: Parameters<typeof judgingProgress>[0],
  stage: JudgingStage,
): void {
  const progress = judgingProgress(facts);
  if (progress.kind !== 'stage_due' || progress.due.stage !== stage)
    throw createAppError('CONFLICT', 'Judging stage not due');
}

/** One application-owned progression for inspection, dispatch, records and recovery. */
export const judgingProgression: JudgingProgression = async (session) => {
  const progress = judgingProgress(session.facts);
  if (session.kind === 'dispatch' || session.kind === 'record')
    requireNextStage(session.facts, session.stage);
  const spendFirstPass =
    session.kind === 'takeover'
      ? firstPassLost(session.facts, session.priorFirstAttempt)
      : session.kind === 'failure' && session.stage === 'first';
  await session.apply({ progress, spendFirstPass });
};
