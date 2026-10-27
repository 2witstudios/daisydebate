import { isNamedSeat, type RoundView } from '@daisy/protocol';
import { roundPositionAt } from '@daisy/debate-engine/position';
import { roundControlIntents } from './control-intents';

/** What Leave does for this viewer now (ADR 0070). */
export type LeaveIntent =
  | { readonly kind: 'navigate' }
  /** A debater after the last speech: the Room no longer holds them (ISSUE-590). */
  | { readonly kind: 'freed' }
  | {
      readonly kind: 'forfeit';
      readonly participantId: string;
      readonly expectedVersion: number;
    };

/** Whether the debate is over and the Round waits only for its ballot. */
const awaitingBallot = (view: RoundView, nowMs: number) =>
  view.status === 'active' &&
  view.checkpoint !== null &&
  roundPositionAt({
    round: view,
    rules: view.rules,
    segments: view.segments,
    checkpoint: view.checkpoint,
    nowMs,
  }).awaitingBallot;

/**
 * Leaving a live Round forfeits it: a debater's own scheduled Round, or an
 * active one while forfeit is a legal intent. After the last speech a
 * debater leaves freed, forfeiting nothing, since judging is the judge's
 * work and the Room released them when the debate ended (ADR 0070). Judges
 * and anyone unseated only navigate.
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
  if (forfeits)
    return {
      kind: 'forfeit',
      participantId: seat.id,
      expectedVersion: view.version,
    };
  return awaitingBallot(view, nowMs) ? { kind: 'freed' } : { kind: 'navigate' };
}
