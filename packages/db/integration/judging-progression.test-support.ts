import { createAppError } from '@daisy/errors';
import {
  judgingProgress,
  firstPassLost,
} from '@daisy/protocol/round-judging-progression';
import type { JudgingProgression } from '../src/round-judging-jobs';
/** Trusted raw-store fixture; application suites bind the real feature driver. */
export const fixtureJudgingProgression: JudgingProgression = async (
  session,
) => {
  const progress = judgingProgress(session.facts);
  if (
    (session.kind === 'dispatch' || session.kind === 'record') &&
    (progress.kind !== 'stage_due' || progress.due.stage !== session.stage)
  )
    throw createAppError('CONFLICT', 'Judging stage not due');
  await session.apply({
    progress,
    spendFirstPass:
      session.kind === 'takeover'
        ? firstPassLost(session.facts, session.priorFirstAttempt)
        : session.kind === 'failure' && session.stage === 'first',
  });
};
