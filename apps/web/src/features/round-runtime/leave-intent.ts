import { isNamedSeat, type RoundView } from '@daisy/protocol';
import { roundControlIntents } from './control-intents';

/** What Leave does for this viewer now (ADR 0070). */
export type LeaveIntent =
  | { readonly kind: 'navigate' }
  | {
      readonly kind: 'forfeit';
      readonly participantId: string;
      readonly expectedVersion: number;
    };

/**
 * Leaving a live Round forfeits it: a debater's own scheduled Round, or an
 * active one while forfeit is a legal intent. After the last speech, and
 * for judges and anyone unseated, Leave only navigates.
 */
export function leaveIntent(
  view: RoundView,
  actorId: string,
  nowMs: number,
): LeaveIntent {
  const seat = view.participants
    .filter(isNamedSeat)
    .find(
      (p) => p.actorId === actorId && p.kind === 'human' && p.role !== 'judge',
    );
  if (seat === undefined) return { kind: 'navigate' };
  const forfeits =
    view.status === 'scheduled' ||
    roundControlIntents(view, actorId, nowMs).some(
      (intent) => intent.type === 'forfeit' && intent.enabled,
    );
  return forfeits
    ? {
        kind: 'forfeit',
        participantId: seat.id,
        expectedVersion: view.version,
      }
    : { kind: 'navigate' };
}
