import {
  isDebatingSeat,
  isJudgeSeat,
  sameSeat,
  seatOrder,
  sideOfSeat,
  type SeatRef,
} from '@daisy/protocol/seats';
import {
  isNamedSeat,
  type RoundSeat,
  type RoundView,
} from '@daisy/protocol/round-view';
import { isRoundRunning } from '@daisy/protocol/round';
import type { RoundPosition } from '@daisy/protocol/runtime';
import { instantMs } from '@daisy/clock';

/**
 * The one reading of a Round's people and floor (ISSUE-672) that the
 * debater room and the spectator view share, so a rule change, such as who
 * holds a point of information, reaches everyone who
 * watches it the same way.
 */

type Participant = RoundView['participants'][number];

/** A competitor's seat: a side's seat or an unsided speaker's, never a judge's. */
export type Seat = RoundSeat;

export const isSeat = (p: Participant): p is Seat =>
  isNamedSeat(p) && isDebatingSeat(p.seat);

/**
 * Where the open speech's offer window stands at `nowMs` (INTX-13): still in
 * its protected start, open, or past its protected end. The notice and the
 * Offer control read this one answer.
 */
export const offerWindowAt = (
  point: NonNullable<RoundPosition['pointOfInformation']>,
  nowMs: number,
): {
  readonly window: 'protected-start' | 'open' | 'protected-end';
  readonly opensInMs: number;
} => {
  const opensInMs = Math.max(0, instantMs(point.offersOpenAt) - nowMs);
  return {
    opensInMs,
    window:
      opensInMs > 0
        ? 'protected-start'
        : nowMs >= instantMs(point.offersCloseAt)
          ? 'protected-end'
          : 'open',
  };
};

/** A debater's label by seat id, or the words the sentence uses when there is none. */
export const debaterLabel = (
  view: Pick<RoundView, 'participants'>,
  participantId: string,
  fallback: string,
): string =>
  view.participants.filter(isSeat).find((p) => p.id === participantId)?.label ??
  fallback;

/** Every competitor seat, in the format's display order. */
export const seatsOf = (view: Pick<RoundView, 'participants' | 'rules'>) =>
  view.participants
    .filter(isSeat)
    .sort((a, b) => seatOrder(view.rules.sides)(a.seat, b.seat));

/** A Round that has not ended: opening, or running. */
export const isLiveRound = (view: Pick<RoundView, 'status'>): boolean =>
  isRoundRunning(view.status);

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
