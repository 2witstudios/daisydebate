import { isRoundRunning } from '@daisy/protocol';
import { ballotFields } from './fields';
import { createAppError } from '@daisy/errors';
import type { RoundBallotRead } from '@daisy/protocol';
import type { BallotDebaters } from '../judge/ballot';
import type { RoundBallotFormState } from './form';
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
      return ballotFields(Object.entries(answer.values), true).ok
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
