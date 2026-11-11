import { isNamedSeat, type RoundView } from '@daisy/protocol';
import {
  roundControlsAt,
  roundPositionAt,
} from '@daisy/debate-engine/position';
import { roundControlIntents } from './control-intents';

/** What Leave does for this viewer now (ADR 0070). */
export type LeaveIntent =
  | { readonly kind: 'navigate' }
  /** A seated debater whose forfeit is unavailable right now: nothing can confirm leaving. */
  | { readonly kind: 'held' }
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
  }).stage === 'awaiting_ballot';

/**
 * Whether the engine takes this seat's forfeit in the opening: the rule its
 * `forfeitInOpening` enforces, read here without the opening's secret seed.
 */
const forfeitsInOpening = (
  view: RoundView,
  seat: Extract<RoundView['participants'][number], { actorId: string }>,
  nowMs: number,
) =>
  roundControlsAt({
    round: view,
    rules: view.rules,
    segments: view.segments,
    checkpoint: view.checkpoint,
    participants: view.participants.filter(isNamedSeat),
    seat,
    nowMs,
  }).options.some((option) => option.type === 'forfeit' && option.legal);

/**
 * Leaving a live Round forfeits it: a debater's own opening Round, or an
 * active one, while forfeit is a legal intent. After the last speech a
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
      (p) => p.actorId === actorId && p.kind === 'human' && p.role !== 'judge',
    );
  if (seat === undefined) return { kind: 'navigate' };
  // The opening offers no control intents: its one command is the strike.
  const forfeits =
    view.status === 'opening'
      ? forfeitsInOpening(view, seat, nowMs)
      : roundControlIntents(view, actorId, nowMs).some(
          (intent) => intent.type === 'forfeit' && intent.enabled,
        );
  if (forfeits)
    return {
      kind: 'forfeit',
      participantId: seat.id,
      expectedVersion: view.version,
    };
  return awaitingBallot(view, nowMs) ? { kind: 'freed' } : { kind: 'held' };
}
