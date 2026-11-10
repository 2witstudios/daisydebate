import {
  roundPositionAt,
  type RoundPosition,
} from '@daisy/debate-engine/position';
import type { DebateSide, RoundView } from '@daisy/protocol';
import { judgingClockOf } from './judging-window';
import { floorSideOf, isSeat, judgeKindOf, sideName } from './round-reading';

/** What one side is doing at one instant, as anyone watching can see it. */
export type ObservedActivity =
  'speaking' | 'listening' | 'asking' | 'answering' | 'preparing' | 'waiting';

export type ObservedSeat = {
  readonly side: DebateSide;
  readonly label: string;
  readonly bot: boolean;
  readonly activity: ObservedActivity;
};

export type ObservedSpeechState = 'done' | 'now' | 'next' | 'upcoming';

export type ObservedSpeech = {
  readonly key: string;
  readonly label: string;
  readonly side: DebateSide;
  readonly kind: 'speech' | 'cross-ex';
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

export type ObservedClock = {
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
  /** Affirmative first, then negative. */
  readonly seats: readonly ObservedSeat[];
  readonly speeches: readonly ObservedSpeech[];
  /** Each side's in-round prep left; null when none is kept or the Round has not begun. */
  readonly prepMs: Readonly<Record<DebateSide, number>> | null;
  readonly judge: 'ai' | 'human' | null;
};

function stageOf(view: RoundView, position: RoundPosition): ObservedStage {
  if (position.stage === 'awaiting_ballot') return 'judging';
  if (position.openSegment)
    return position.openSegment.type === 'cross_ex' ? 'cross-ex' : 'speech';
  if (position.prep) return 'prep';
  if (position.countdownRemainingMs !== null) return 'countdown';
  return view.status === 'opening' ? 'starting' : 'between';
}

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
          ? `Cross-examination · ${sideName[open.side]} asks`
          : `${open.key} · ${open.label}`,
      remainingMs: open.remainingMs,
    };
  if (position.prep)
    return {
      label: `${sideName[position.prep.side]} prep`,
      remainingMs: position.prep.remainingMs,
    };
  if (position.countdownRemainingMs !== null)
    return { label: 'Starts in', remainingMs: position.countdownRemainingMs };
  return null;
}

function activityOf(
  view: RoundView,
  position: RoundPosition | null,
  side: DebateSide,
): ObservedActivity {
  const open = position?.openSegment;
  if (open?.type === 'cross_ex')
    return open.side === side ? 'asking' : 'answering';
  if (open) return floorSideOf(view, open) === side ? 'speaking' : 'listening';
  if (position?.prep?.side === side) return 'preparing';
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

function speechesOf(view: RoundView, marks: Marks): readonly ObservedSpeech[] {
  return view.rules.segments.map((segment, sequence) => ({
    key: segment.key,
    label: segment.label,
    side: segment.side,
    kind: segment.type === 'cross_ex' ? 'cross-ex' : 'speech',
    durationMs: segment.durationMs,
    state: speechState(sequence, marks),
  }));
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
        remainingMs: Math.max(0, Date.parse(step.endsAt) - nowMs),
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
  const seats = (['affirmative', 'negative'] as const).flatMap((side) => {
    const seat = view.participants.filter(isSeat).find((p) => p.role === side);
    if (!seat) return [];
    return [
      {
        side,
        label: seat.label,
        bot: seat.kind === 'bot',
        activity: activityOf(view, position, side),
      } satisfies ObservedSeat,
    ];
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
      budget && view.status === 'active'
        ? { affirmative: budget.affirmative, negative: budget.negative }
        : null,
    judge: judgeKindOf(view),
  };
}
