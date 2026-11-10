import { drawnTopicLabel } from '../../features/debate-room/vocabulary';
import {
  roundPositionAt,
  type RoundPosition,
} from '@daisy/debate-engine/position';
import { microphoneOpensForClock } from '@daisy/debate-engine/media-grants';
import type { DebateSide, RoundView } from '@daisy/protocol';
import {
  floorSideOf,
  isLiveRound,
  isSeat,
  judgeKindOf,
  sideName,
  type Seat,
} from '../../features/round-runtime/round-reading';
import { initialsOf } from '../../lib/initials';
import type { Side, SpeechSlot } from '../../features/debate-room/speeches';
import { judgingBallotsOf } from '../../features/debate-room/judging';
import { judgingClockOf } from '../../features/round-runtime/judging-window';
import type { RoundPhase } from '../../features/debate-room/layout';
import type { Debater, RoundPerson, RoundSnapshot } from './round';

type Participant = RoundView['participants'][number];

const sideOf: Readonly<Record<DebateSide, Side>> = {
  affirmative: 'aff',
  negative: 'neg',
};
const debaterSeat = (view: RoundView, actorId: string) =>
  view.participants.filter(isSeat).find((p) => p.actorId === actorId);

/** The round room is for a debater of a round that has not ended. */
export function isLiveDebater(view: RoundView, actorId: string): boolean {
  return isLiveRound(view) && debaterSeat(view, actorId) !== undefined;
}

const debater = (p: Seat): Debater => ({
  id: p.actorId,
  name: p.label,
  initials: initialsOf(p.label),
  side: sideOf[p.role],
  rating: null,
});

const person = (p: Participant): RoundPerson =>
  isSeat(p)
    ? {
        id: p.actorId,
        name: p.label,
        role: sideOf[p.role],
        bot: p.kind === 'bot',
      }
    : {
        id: 'anonymous' in p ? `judge-${p.slot}` : p.id,
        name: 'Judge',
        role: 'judge',
        bot: p.kind === 'bot',
      };

const speechesOf = (view: RoundView): readonly SpeechSlot[] =>
  view.rules.segments.map((segment, index) => ({
    id: `${index}-${segment.key}`,
    code: segment.key,
    name: segment.label,
    side: sideOf[segment.side],
    kind: segment.type === 'cross_ex' ? 'cross-ex' : 'speech',
    durationMs: segment.durationMs,
  }));

const positionOf = (view: RoundView, nowMs: number): RoundPosition =>
  roundPositionAt({
    round: view,
    segments: view.segments,
    checkpoint: view.checkpoint,
    rules: view.rules,
    nowMs,
  });

/** The phase this debater is in, from the derived position. */
function phaseOf(
  view: RoundView,
  position: RoundPosition,
  side: DebateSide,
): RoundPhase {
  if (position.status !== 'active') return 'waiting';
  if (position.stage === 'awaiting_ballot') return 'judging';
  if (position.stage === 'prep')
    return position.prep?.side === side ? 'prep' : 'waiting';
  const open = position.openSegment;
  if (position.stage !== 'live' || !open) return 'waiting';
  if (open.type === 'cross_ex') return 'cross-ex';
  return floorSideOf(view, open) === side ? 'own-speech' : 'opponent-speaking';
}

const segmentClock = (
  open: NonNullable<RoundPosition['openSegment']>,
  side: DebateSide,
) => ({
  label:
    open.type === 'cross_ex'
      ? `Cross-examination · ${open.side === side ? 'You ask' : 'You answer'}`
      : `${open.key} · ${open.label}`,
  remainingMs: open.remainingMs,
});

const prepClock = (
  prep: NonNullable<RoundPosition['prep']>,
  side: DebateSide,
  micOpens: boolean,
) => ({
  label: prep.side === side ? 'Your prep' : `${sideName[prep.side]} prep`,
  remainingMs: prep.remainingMs,
  // Prep can run out while the seat talks to themselves, and the other side can hear them then.
  ...(micOpens
    ? { note: 'Your microphone goes live when this prep ends.' }
    : {}),
});

/** The main clock: the open segment, prep, the countdown, or the first speech's length. */
function clockOf(
  view: RoundView,
  position: RoundPosition,
  side: DebateSide,
  seatId: string,
): RoundSnapshot['clock'] {
  if (position.openSegment) return segmentClock(position.openSegment, side);
  // Told before it opens, because the other side can hear it from then. The same decision
  // that opens it, so a cross-examination's two seats are both told.
  const micOpens =
    position.nextSegment !== null &&
    microphoneOpensForClock({
      rules: view.rules,
      participants: view.participants.filter(isSeat),
      participantId: seatId,
      nextSequence: position.nextSegment.sequence,
    });
  if (position.prep) return prepClock(position.prep, side, micOpens);
  if (position.countdownRemainingMs !== null)
    return {
      label: 'Starts in',
      remainingMs: position.countdownRemainingMs,
      ...(micOpens
        ? { note: 'Your microphone goes live just before your clock starts.' }
        : {}),
    };
  const first = view.rules.segments[0];
  if (view.status !== 'opening' || !first) return null;
  return {
    label: `${first.key} · ${first.label}`,
    remainingMs: first.durationMs,
  };
}

/** The lit speech: the one open, else the one prep or the countdown leads to. */
function liveIndexOf(view: RoundView, position: RoundPosition): number {
  if (position.stage === 'awaiting_ballot') return view.rules.segments.length;
  if (position.openSegment) return position.openSegment.sequence;
  if (position.status !== 'active') return -1;
  return position.nextSegment?.sequence ?? -1;
}

const prepOf = (position: RoundPosition): RoundSnapshot['prepMs'] => {
  const budget = position.prepBudgetRemainingMs;
  return budget ? { aff: budget.affirmative, neg: budget.negative } : null;
};

/**
 * The phase, lit speech and clocks at one instant. A Round with no judge
 * seat has no judging window: it finishes unjudged after the speeches
 * (DEC-191). An active round whose
 * checkpoint could not be read has no live position: waiting, nothing lit,
 * no clock, rather than a position guessed from an empty checkpoint.
 */
function liveParts(
  view: RoundView,
  side: DebateSide,
  seatId: string,
  nowMs: number,
): Pick<RoundSnapshot, 'phase' | 'liveIndex' | 'clock' | 'prepMs'> {
  if (view.status === 'active' && view.checkpoint === null)
    return { phase: 'waiting', liveIndex: -1, clock: null, prepMs: null };
  const step = view.opening?.step;
  if (step?.step === 'prep')
    return {
      phase: 'prep',
      liveIndex: -1,
      clock: {
        label: 'Prep',
        remainingMs: Math.max(0, Date.parse(step.endsAt) - nowMs),
      },
      prepMs: null,
    };
  const position = positionOf(view, nowMs);
  const phase = phaseOf(view, position, side);
  return {
    phase,
    liveIndex: liveIndexOf(view, position),
    clock:
      phase !== 'judging'
        ? clockOf(view, position, side, seatId)
        : judgingClockOf(view.waitingOn, nowMs),
    prepMs: prepOf(position),
  };
}

/**
 * One debater's room at one instant, derived from the round's durable
 * snapshot with the same reader the server uses. The mic follows the
 * floor (DEC-97). Floor chat is bound separately to its authorized durable channel.
 */
export function liveRoundOf(
  view: RoundView,
  actorId: string,
  nowMs: number,
): RoundSnapshot | null {
  const seat = debaterSeat(view, actorId);
  if (!isLiveRound(view) || !seat) return null;
  const opponent = view.participants
    .filter(isSeat)
    .find((p) => p.role !== seat.role);
  if (!opponent) return null;
  const { phase, ...clocks } = liveParts(view, seat.role, seat.id, nowMs);
  return {
    id: view.id,
    resolution: view.topic ?? drawnTopicLabel,
    competition: view.competitionType,
    phase,
    self: debater(seat),
    opponent: debater(opponent),
    people: view.participants.map(person),
    judge: judgeKindOf(view),
    ballots: judgingBallotsOf(judgeKindOf(view)),
    judgingState: view.waitingOn?.state ?? null,
    stakes: null,
    speeches: speechesOf(view),
    ...clocks,
    micLive: phase === 'own-speech' || phase === 'cross-ex',
    channels: [],
    messages: [],
    agents: [{ id: 'assistant', title: 'Assistant' }],
    agentThreads: {},
    agentPrompts: {},
  };
}
