import { createAppError } from '@daisy/errors';
import type {
  JudgingProgressionRequest,
  JudgingProgressionDecision,
  JudgingStageFacts,
} from '@daisy/protocol/round-judging-progression';

type JudgingProgressionSession = JudgingProgressionRequest & {
  readonly apply: (decision: JudgingProgressionDecision) => Promise<void>;
};
export type JudgingProgression = (
  session: JudgingProgressionSession,
) => Promise<void>;

/** Expose only the named stage facts, never mutable storage rows. */
export const judgingStageFacts = (
  job: JudgingStageFacts,
): JudgingStageFacts => ({
  pendingBallot: job.pendingBallot,
  firstBallot: job.firstBallot,
  firstBallotFailed: job.firstBallotFailed,
  caseMap: job.caseMap,
});

/** The judging family's one atomic progression apply, terminal after callback release. */
export async function applyJudgingProgression<T>(
  progression: JudgingProgression,
  request: JudgingProgressionRequest,
  apply: (
    decision: JudgingProgressionDecision,
    writing: () => void,
  ) => Promise<T>,
): Promise<T> {
  let state:
    | { readonly kind: 'open' | 'applying' | 'closed' }
    | { readonly kind: 'settled'; readonly result: T } = { kind: 'open' };
  let pending: Promise<void> | undefined;
  const phase = () => state;
  const writing = () => {
    if (phase().kind !== 'applying') throw createAppError('CONFLICT');
  };
  try {
    await progression({
      ...request,
      apply: async (decision) => {
        if (phase().kind !== 'open') throw createAppError('CONFLICT');
        state = { kind: 'applying' };
        pending = (async () => {
          const result = await apply(decision, writing);
          writing();
          state = { kind: 'settled', result };
        })();
        await pending;
      },
    });
    const settled = phase();
    if (settled.kind !== 'settled') throw createAppError('CONFLICT');
    return settled.result;
  } finally {
    state = { kind: 'closed' };
    // A released callback cannot leave nested SQL running after transaction rollback.
    if (pending) await Promise.allSettled([pending]);
  }
}
