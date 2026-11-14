import { createAppError } from '@daisy/errors';
import { isRoundRunning } from '@daisy/protocol';
import { ballotFields } from './fields';
import type { RoundBallotRead } from '@daisy/protocol';
import { ballotPlanFor, type BallotPlan } from '../judge/ballot-plan';
import type { RoundBallotFormState } from './form';
/**
 * The Round's ballot: subject names come from all authoritative competitor
 * seats, never from judge identity or a sample; the definition is the one
 * the Round froze at Start round, never one inferred from its rules.
 */
export const ballotPlanOf = (view: RoundBallotRead): BallotPlan => {
  if (!view.judging)
    throw createAppError('INVARIANT', 'A Round judged by nobody has no ballot');
  return ballotPlanFor(view.round, view.judging.ballot);
};
export type BallotDisplay =
  'retry' | 'recorded' | 'open' | 'waiting' | 'decided';
/** What the ballot page shows: the answer decides first, then the persisted Round. */
export function ballotDisplay(
  view: RoundBallotRead,
  answer: RoundBallotFormState,
): BallotDisplay {
  switch (answer.kind) {
    case 'recorded':
      return 'recorded';
    case 'unacknowledged':
      // Only a ballot that can be posted again unchanged is offered for retry.
      return ballotFields(
        Object.entries(answer.values),
        ballotPlanOf(view),
        true,
      ).ok
        ? 'retry'
        : persistedDisplay(view);
    case 'idle':
    case 'refused':
    case 'moved':
      return persistedDisplay(view);
  }
}
function persistedDisplay(view: RoundBallotRead): BallotDisplay {
  if (view.own?.ballot) return 'recorded';
  if (ballotOpen(view)) return 'open';
  return pendingDisplay(view.round.status);
}
function ballotOpen(view: RoundBallotRead): boolean {
  return (
    view.own?.ballot === null &&
    view.round.status === 'active' &&
    view.freeze !== null
  );
}

function pendingDisplay(
  status: RoundBallotRead['round']['status'],
): BallotDisplay {
  return isRoundRunning(status) ? 'waiting' : 'decided';
}
