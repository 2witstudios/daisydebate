import {
  isDebatingSeat,
  isJudgeSeat,
  isNamedSeat,
  isRoundRunning,
  sameSeat,
  seatOrder,
  sideOfSeat,
  type RoundSeat,
  type RoundView,
  type SeatRef,
} from '@daisy/protocol';
import type { RoundPosition } from '@daisy/debate-engine/position';

/**
 * The one reading of a Round's people and floor (ISSUE-672) that the
 * debater room and the spectator view share, so a rule change, such as who
 * holds the floor after an accepted interruption, reaches everyone who
 * watches it the same way.
 */

type Participant = RoundView['participants'][number];

/** A competitor's seat: a side's seat or an unsided speaker's, never a judge's. */
export type Seat = RoundSeat;

export const isSeat = (p: Participant): p is Seat =>
  isNamedSeat(p) && isDebatingSeat(p.seat);

/** Every competitor seat, in the format's display order. */
export const seatsOf = (view: Pick<RoundView, 'participants' | 'rules'>) =>
  view.participants
    .filter(isSeat)
    .sort((a, b) => seatOrder(view.rules.sides)(a.seat, b.seat));

/** A Round that has not ended: opening, or running. */
export const isLiveRound = (view: Pick<RoundView, 'status'>): boolean =>
  isRoundRunning(view.status);

/**
 * Who holds the floor: an accepted interruption's seat, else the seat the
 * segment is scheduled to; null for an open floor nobody leads.
 */
export const floorSeatOf = (
  view: Pick<RoundView, 'participants'>,
  open: Pick<
    NonNullable<RoundPosition['openSegment']>,
    'lead' | 'floorParticipantId'
  >,
): SeatRef | null =>
  view.participants.filter(isSeat).find((p) => p.id === open.floorParticipantId)
    ?.seat ?? open.lead;

/**
 * Whether two competitor seats stand together: the same side, or, unsided,
 * the same seat. A teammate's speech is the side's speech.
 */
export const sameTeam = (a: SeatRef | null, b: SeatRef | null): boolean => {
  if (a === null || b === null) return false;
  const side = sideOfSeat(a);
  return side !== null ? side === sideOfSeat(b) : sameSeat(a, b);
};

/** The judge's kind, never their name: an AI, a human, or no judge seat. */
export const judgeKindOf = (
  view: Pick<RoundView, 'participants'>,
): 'ai' | 'human' | null => {
  const judge = view.participants.find((p) => isJudgeSeat(p.seat));
  if (!judge) return null;
  return judge.kind === 'bot' ? 'ai' : 'human';
};
