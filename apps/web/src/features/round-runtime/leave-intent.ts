import { isAbsentSeat } from '@daisy/protocol/round';
import { isDebatingSeat } from '@daisy/protocol/seats';
import { isNamedSeat, type RoundView } from '@daisy/protocol/round-view';
import {
  forfeitsToOpponent,
  roundPositionAt,
} from '@daisy/debate-engine/position';
import { withdrawalLegalNow } from './control-intents';

/** What Leave does for this viewer now (ADR 0070). */
export type LeaveIntent =
  | { readonly kind: 'navigate' }
  /** A seated debater whose withdrawal is unavailable right now: nothing can confirm leaving. */
  | { readonly kind: 'held' }
  /** A debater after the last speech: the Room no longer holds them (ISSUE-590). */
  | { readonly kind: 'freed' }
  | {
      /**
       * A two-sided winner Round is forfeited; any other is left, the seat
       * recorded absent while the Round goes on (TAB-6.8).
       */
      readonly kind: 'forfeit' | 'leave';
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
  }).stage === 'awaiting_ballot';

/**
 * Leaving a live Round forfeits it: a debater's own opening or active Round,
 * while the engine would take the forfeit. A Round no forfeit ends (not
 * two-sided, or not decided by a winner) is left instead: the seat is
 * absent and the Round goes on (TAB-6.8); a seat that already left only
 * navigates. After the last speech a
 * debater leaves freed, forfeiting nothing, since judging is the judge's
 * work and the Room released them when the debate ended (ADR 0070). A debater
 * between persisted phases is held, since forfeit cannot be posted yet. Judges
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
      (p) =>
        p.actorId === actorId && p.kind === 'human' && isDebatingSeat(p.seat),
    );
  if (
    seat === undefined ||
    (view.checkpoint !== null && isAbsentSeat(view.checkpoint, seat.id))
  )
    return { kind: 'navigate' };
  const kind = forfeitsToOpponent(view.rules) ? 'forfeit' : 'leave';
  if (withdrawalLegalNow(view, actorId, nowMs, kind))
    return {
      kind,
      participantId: seat.id,
      expectedVersion: view.version,
    };
  return awaitingBallot(view, nowMs) ? { kind: 'freed' } : { kind: 'held' };
}
