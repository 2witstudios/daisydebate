import { instantMs } from '@daisy/clock';
import {
  roundPositionAt,
  type RoundPosition,
} from '@daisy/debate-engine/position';
import { leadSeatOf } from '@daisy/protocol/format-seating';
import {
  seatKey,
  sideOfSeat,
  type SeatRef,
  type SideKey,
} from '@daisy/protocol/seats';
import { type RoundView } from '@daisy/protocol/round-view';
import { type SegmentType } from '@daisy/protocol/format';
import { seatName, sideName } from '../debate-room/seat-names';
import { sideToneOf, type SideTone } from '../debate-room/speeches';
import { judgingClockOf } from './judging-window';
import {
  floorSeatOf,
  judgeKindOf,
  sameTeam,
  seatsOf,
  type Seat,
} from './round-reading';

/** What one side is doing at one instant, as anyone watching can see it. */
export type ObservedActivity =
  'speaking' | 'listening' | 'asking' | 'answering' | 'preparing' | 'waiting';

export type ObservedSeat = {
  /** The seat's stable key: one card per side, or per unsided speaker. */
  readonly key: string;
  readonly seat: SeatRef;
  /** The seat's side; null for an unsided speaker. */
  readonly side: SideKey | null;
  /** "Affirmative", or "Speaker 2" for an unsided seat. */
  readonly sideLabel: string;
  readonly tone: SideTone;
  readonly label: string;
  readonly bot: boolean;
  readonly activity: ObservedActivity;
};

export type ObservedSpeechState = 'done' | 'now' | 'next' | 'upcoming';

export type ObservedSpeech = {
  readonly key: string;
  readonly label: string;
  /** The seat the segment is scheduled to; null for an open floor. */
  readonly lead: SeatRef | null;
  readonly tone: SideTone;
  readonly kind: 'speech' | 'cross-ex' | 'open';
  readonly durationMs: number;
  readonly state: ObservedSpeechState;
};

/**
 * Where the Round is. `strike` and `opening-prep` are the opening (ADR
 * 0104); `starting` is an opening with nothing running; `between` is an
 * active Round with no speech, prep or countdown running, or one whose live
 * position cannot be read.
 */
export type ObservedStage =
  | 'strike'
  | 'opening-prep'
  | 'starting'
  | 'countdown'
  | 'speech'
  | 'cross-ex'
  | 'prep'
  | 'between'
  | 'judging';

type ObservedClock = {
  readonly label: string;
  readonly remainingMs: number;
};

/**
 * A live Round as someone without a debater's seat sees it: no side is
 * "you", no control is offered, and a human judge is never named. Read by
 * the spectator view and the judge's room alike.
 */
export type ObservedRound = {
  readonly stage: ObservedStage;
  readonly clock: ObservedClock | null;
  /** Each side in declared order, then each unsided speaker. */
  readonly seats: readonly ObservedSeat[];
  readonly speeches: readonly ObservedSpeech[];
  /** Each side's in-round prep left, by side key; null when none is kept or the Round has not begun. */
  readonly prepMs: Readonly<Record<SideKey, number>> | null;
  readonly judge: 'ai' | 'human' | null;
};

function stageOf(view: RoundView, position: RoundPosition): ObservedStage {
  if (position.stage === 'awaiting_ballot') return 'judging';
  if (position.openSegment)
    return position.openSegment.type === 'speech' ? 'speech' : 'cross-ex';
  if (position.prep) return 'prep';
  if (position.countdownRemainingMs !== null) return 'countdown';
  return view.status === 'opening' ? 'starting' : 'between';
}

/** The scheduled seat's side by name, or the seat's own name unsided. */
const leadName = (view: RoundView, lead: SeatRef | null): string => {
  if (lead === null) return 'Everyone';
  const side = sideOfSeat(lead);
  return side === null
    ? seatName(view.rules, lead)
    : sideName(view.rules.sides, side);
};

function clockOf(
  view: RoundView,
  position: RoundPosition,
  nowMs: number,
): ObservedClock | null {
  if (position.stage === 'awaiting_ballot')
    return judgingClockOf(view.waitingOn, nowMs);
  const open = position.openSegment;
  if (open)
    return {
      label:
        open.type === 'cross_ex'
          ? `Cross-examination · ${leadName(view, open.lead)} asks`
          : `${open.key} · ${open.label}`,
      remainingMs: open.remainingMs,
    };
  if (position.prep)
    return {
      label: `${sideName(view.rules.sides, position.prep.side)} prep`,
      remainingMs: position.prep.remainingMs,
    };
  if (position.countdownRemainingMs !== null)
    return { label: 'Starts in', remainingMs: position.countdownRemainingMs };
  return null;
}

function activityOf(
  view: RoundView,
  position: RoundPosition | null,
  seat: SeatRef,
): ObservedActivity {
  const open = position?.openSegment;
  if (open && open.type !== 'speech')
    return sameTeam(open.lead, seat) ? 'asking' : 'answering';
  if (open)
    return sameTeam(floorSeatOf(view, open), seat) ? 'speaking' : 'listening';
  const side = sideOfSeat(seat);
  if (side !== null && position?.prep?.side === side) return 'preparing';
  return view.opening?.step.step === 'prep' ? 'preparing' : 'waiting';
}

type Marks = {
  readonly now: number | null;
  readonly next: number | null;
  readonly done: number;
};

function speechState(sequence: number, marks: Marks): ObservedSpeechState {
  if (sequence === marks.now) return 'now';
  if (sequence < marks.done) return 'done';
  return sequence === marks.next ? 'next' : 'upcoming';
}

/** The speech in progress, else the one coming up; every one before it is done. */
function speechMarks(view: RoundView, position: RoundPosition | null): Marks {
  if (!position) return { now: null, next: null, done: 0 };
  if (position.stage === 'awaiting_ballot')
    return { now: null, next: null, done: view.rules.segments.length };
  const open = position.openSegment;
  if (open)
    return { now: open.sequence, next: open.sequence + 1, done: open.sequence };
  const next = position.nextSegment?.sequence ?? null;
  return { now: null, next, done: next ?? 0 };
}

const observedKind = (type: SegmentType): ObservedSpeech['kind'] => {
  switch (type) {
    case 'speech':
      return 'speech';
    case 'cross_ex':
      return 'cross-ex';
    case 'open':
      return 'open';
  }
};

/**
 * One card per side, its first seat by slot, as a two-sided Round has
 * always shown; an unsided format shows every speaker.
 */
const cardSeatsOf = (view: RoundView): readonly Seat[] =>
  seatsOf(view).filter((p, index, seats) => {
    const side = sideOfSeat(p.seat);
    return (
      side === null ||
      seats.findIndex((q) => sideOfSeat(q.seat) === side) === index
    );
  });

function speechesOf(view: RoundView, marks: Marks): readonly ObservedSpeech[] {
  return view.rules.segments.map((segment, sequence) => {
    const lead = leadSeatOf(segment.speak);
    return {
      key: segment.key,
      label: segment.label,
      lead,
      tone: sideToneOf(view.rules.sides, lead && sideOfSeat(lead)),
      kind: observedKind(segment.type),
      durationMs: segment.durationMs,
      state: speechState(sequence, marks),
    };
  });
}

/** The opening's own stages, which the live position does not describe. */
function openingOf(
  view: RoundView,
  nowMs: number,
): Pick<ObservedRound, 'stage' | 'clock'> | null {
  const step = view.opening?.step;
  if (view.status !== 'opening' || !step) return null;
  if (step.step === 'strike') return { stage: 'strike', clock: null };
  if (step.step === 'prep')
    return {
      stage: 'opening-prep',
      clock: {
        label: 'Prep before the round',
        remainingMs: Math.max(0, instantMs(step.endsAt) - nowMs),
      },
    };
  return null;
}

const positionAt = (view: RoundView, nowMs: number): RoundPosition | null =>
  view.status === 'active' && view.checkpoint === null
    ? null
    : roundPositionAt({
        round: view,
        segments: view.segments,
        checkpoint: view.checkpoint,
        rules: view.rules,
        nowMs,
      });

/**
 * The Round at one instant for anyone without a debater's seat, derived with
 * the same position reader the server and the debaters use. An active Round
 * whose checkpoint could not be read has no position: between, nothing lit,
 * no clock, rather than a position guessed from an empty checkpoint.
 */
export function observedRoundOf(view: RoundView, nowMs: number): ObservedRound {
  const position = positionAt(view, nowMs);
  const opening = openingOf(view, nowMs);
  const seats = cardSeatsOf(view).map((p): ObservedSeat => {
    const side = sideOfSeat(p.seat);
    return {
      key: side ?? seatKey(p.seat),
      seat: p.seat,
      side,
      sideLabel:
        side === null
          ? seatName(view.rules, p.seat)
          : sideName(view.rules.sides, side),
      tone: sideToneOf(view.rules.sides, side),
      label: p.label,
      bot: p.kind === 'bot',
      activity: activityOf(view, position, p.seat),
    };
  });
  const budget = position?.prepBudgetRemainingMs ?? null;
  return {
    stage: opening?.stage ?? (position ? stageOf(view, position) : 'between'),
    clock: opening?.clock ?? (position ? clockOf(view, position, nowMs) : null),
    seats,
    speeches: speechesOf(
      view,
      opening ? { now: null, next: 0, done: 0 } : speechMarks(view, position),
    ),
    prepMs:
      budget &&
      view.status === 'active' &&
      position?.stage !== 'awaiting_ballot'
        ? Object.fromEntries(
            view.rules.sides.map((side) => [side.key, budget[side.key] ?? 0]),
          )
        : null,
    judge: judgeKindOf(view),
  };
}
