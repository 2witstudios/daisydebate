import { ballotFields } from './fields';
import { createAppError } from '@daisy/errors';
import type { RoundBallotRead } from '@daisy/protocol';
import type { BallotDebaters } from '../judge/ballot';
/** Side labels come from all authoritative debater seats, never from judge identity or a sample. */
export function ballotDebaters(view: RoundBallotRead): BallotDebaters {
  const side = (role: 'affirmative' | 'negative') =>
    view.round.participants
      .filter((p) => p.role === role && 'label' in p)
      .sort((a, b) => a.slot - b.slot)
      .flatMap((p) => ('label' in p ? [p.label] : []))
      .join(' / ');
  const affirmative = side('affirmative'),
    negative = side('negative');
  if (!affirmative || !negative) throw createAppError('INVARIANT');
  return { affirmative: { name: affirmative }, negative: { name: negative } };
}
export type BallotDisplay =
  'retry' | 'recorded' | 'voided' | 'open' | 'waiting' | 'decided';
export function ballotDisplay(
  view: RoundBallotRead,
  answer: import('./form').RoundBallotFormState,
): BallotDisplay {
  if (
    answer.unacknowledged &&
    ballotFields(Object.entries(answer.values), true).ok
  )
    return 'retry';
  if (view.own?.status === 'voided') return 'voided';
  if (answer.receipt || view.own?.status === 'submitted') return 'recorded';
  if (ballotOpen(view)) return 'open';
  return pendingDisplay(view.round.status);
}
function ballotOpen(view: RoundBallotRead): boolean {
  return (
    view.own?.status === null &&
    view.round.status === 'active' &&
    view.freeze !== null
  );
}

function pendingDisplay(
  status: RoundBallotRead['round']['status'],
): BallotDisplay {
  return status === 'active' || status === 'scheduled' ? 'waiting' : 'decided';
}
