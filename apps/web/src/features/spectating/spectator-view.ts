import {
  roundPositionAt,
  type RoundPosition,
} from '@daisy/debate-engine/position';
import type { DebateSide, RoundView } from '@daisy/protocol';
import {
  floorSideOf,
  isLiveRound,
  isSeat,
  judgeKindOf,
  sideName,
} from '../round-runtime/round-reading';

/**
 * Why a viewer watches the live room of a Round they hold no seat in. Only an
 * undelayed observer does; the public audience watches the delayed Broadcast
 * and never reaches this view.
 */
export type SpectatorKind = 'undelayed-observer';

export type SpectatorActivity =
  'speaking' | 'listening' | 'asking' | 'answering' | 'preparing' | 'waiting';

export type SpectatorSeat = {
  readonly side: DebateSide;
  readonly label: string;
  readonly bot: boolean;
  readonly activity: SpectatorActivity;
};

type SpectatorSpeech = {
  readonly key: string;
  readonly label: string;
  readonly side: DebateSide;
  readonly durationMs: number;
  readonly state: 'done' | 'now' | 'next' | 'upcoming';
};

type SpectatorStage =
  | 'starting'
  | 'countdown'
  | 'speech'
  | 'cross-ex'
  | 'prep'
  | 'between'
  | 'judging';

/**
 * A live Round as anyone without a seat sees it: no side is "you", no
 * control is offered, and a human judge is never named.
 */
export type SpectatorView = {
  readonly stage: SpectatorStage;
  readonly clock: {
    readonly label: string;
    readonly remainingMs: number;
  } | null;
  /** Affirmative first, then negative. */
  readonly seats: readonly SpectatorSeat[];
  readonly speeches: readonly SpectatorSpeech[];
  readonly judge: 'ai' | 'human' | null;
};

/** The kind of spectator a viewer watches as; null without the capability, or once the Round is over. */
export function spectatorKindOf(view: RoundView): SpectatorKind | null {
  return isLiveRound(view) && view.viewerIsUndelayedObserver === true
    ? 'undelayed-observer'
    : null;
}

function stageOf(view: RoundView, position: RoundPosition): SpectatorStage {
  if (view.status === 'opening') return 'starting';
  if (position.stage === 'awaiting_ballot') return 'judging';
  if (position.openSegment)
    return position.openSegment.type === 'cross_ex' ? 'cross-ex' : 'speech';
  if (position.prep) return 'prep';
  if (position.countdownRemainingMs !== null) return 'countdown';
  return 'between';
}

function clockOf(position: RoundPosition): SpectatorView['clock'] {
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
  position: RoundPosition,
  side: DebateSide,
): SpectatorActivity {
  const open = position.openSegment;
  if (open?.type === 'cross_ex')
    return open.side === side ? 'asking' : 'answering';
  if (open) return floorSideOf(view, open) === side ? 'speaking' : 'listening';
  if (position.prep?.side === side) return 'preparing';
  return 'waiting';
}

type SpeechState = SpectatorSpeech['state'];

function speechState(
  sequence: number,
  marks: {
    readonly now: number | null;
    readonly next: number | null;
    readonly done: number;
  },
): SpeechState {
  if (sequence === marks.now) return 'now';
  if (sequence < marks.done) return 'done';
  return sequence === marks.next ? 'next' : 'upcoming';
}

/** The speech in progress, else the one coming up; every one before it is done. */
function speechMarks(view: RoundView, position: RoundPosition | null) {
  if (!position) return { now: null, next: null, done: 0 };
  if (position.stage === 'awaiting_ballot')
    return { now: null, next: null, done: view.rules.segments.length };
  const open = position.openSegment;
  if (open)
    return { now: open.sequence, next: open.sequence + 1, done: open.sequence };
  const next = position.nextSegment?.sequence ?? null;
  return { now: null, next, done: next ?? 0 };
}

function speechesOf(
  view: RoundView,
  position: RoundPosition | null,
): readonly SpectatorSpeech[] {
  const marks = speechMarks(view, position);
  return view.rules.segments.map((segment, sequence) => ({
    key: segment.key,
    label: segment.label,
    side: segment.side,
    durationMs: segment.durationMs,
    state: speechState(sequence, marks),
  }));
}

/**
 * The Round at one instant for a spectator, derived with the same position
 * reader the server and the debaters use. An active Round whose checkpoint
 * could not be read has no position: waiting, nothing lit, no clock.
 */
export function spectatorViewOf(view: RoundView, nowMs: number): SpectatorView {
  const position =
    view.status === 'active' && view.checkpoint === null
      ? null
      : roundPositionAt({
          round: view,
          segments: view.segments,
          checkpoint: view.checkpoint,
          rules: view.rules,
          nowMs,
        });
  const seats = (['affirmative', 'negative'] as const).flatMap((side) => {
    const seat = view.participants.filter(isSeat).find((p) => p.role === side);
    if (!seat) return [];
    return [
      {
        side,
        label: seat.label,
        bot: seat.kind === 'bot',
        activity: position ? activityOf(view, position, side) : 'waiting',
      } satisfies SpectatorSeat,
    ];
  });
  return {
    stage: position ? stageOf(view, position) : 'between',
    clock: position ? clockOf(position) : null,
    seats,
    speeches: speechesOf(view, position),
    judge: judgeKindOf(view),
  };
}

/** Which live view a member without a debater's seat gets, with what it needs. */
export type WatchingRoom<R> =
  | { readonly kind: 'judge'; readonly round: R }
  | { readonly kind: 'spectator'; readonly spectatorKind: SpectatorKind }
  | { readonly kind: 'receipt' };

/**
 * The room route's order for a member without a debater's seat (ISSUE-673):
 * the assigned judge's live view first, so a host who also judges judges;
 * then a spectator's view for a spectator kind; else the Round's receipt.
 */
export function watchingRoomOf<R extends Pick<RoundView, 'status'>>(input: {
  readonly judgeRound: R | null;
  readonly spectatorKind: SpectatorKind | null;
}): WatchingRoom<R> {
  if (input.judgeRound !== null)
    return isLiveRound(input.judgeRound)
      ? { kind: 'judge', round: input.judgeRound }
      : { kind: 'receipt' };
  return input.spectatorKind === null
    ? { kind: 'receipt' }
    : { kind: 'spectator', spectatorKind: input.spectatorKind };
}
