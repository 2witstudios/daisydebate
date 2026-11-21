import { instantMs } from '@daisy/clock';
import { drawnTopicLabel } from '../../features/debate-room/vocabulary';
import {
  roundPositionAt,
  type RoundPosition,
} from '@daisy/debate-engine/position';
import {
  postRoundCallEndsAtMs,
  postRoundCallOffered,
} from '../../features/post-round-call/offered';
import { microphoneOpensForClock } from '@daisy/debate-engine/media-grants';
import {
  isAbsentSeat,
  leadSeatOf,
  sideOfSeat,
  speakingSeatsOf,
  type RoundView,
  type SeatRef,
  type SegmentType,
  type SideKey,
} from '@daisy/protocol';
import {
  floorSeatOf,
  isLiveRound,
  isSeat,
  judgeKindOf,
  sameTeam,
  seatsOf,
  type Seat,
} from '../../features/round-runtime/round-reading';
import { sideName } from '../../features/debate-room/seat-names';
import {
  sideToneOf,
  type SpeechSlot,
} from '../../features/debate-room/speeches';
import { judgingBallotsOf } from '../../features/debate-room/judging';
import { judgingClockOf } from '../../features/round-runtime/judging-window';
import type { RoundPhase } from '../../features/debate-room/layout';
import type { RoundSnapshot } from './round';
import { debaterOf, personOf, seatGroupsOf } from './round-seats';

const debaterSeat = (view: RoundView, actorId: string) =>
  view.participants.filter(isSeat).find((p) => p.actorId === actorId);

/** The round room is for a debater of a round that has not ended. */
export function isLiveDebater(view: RoundView, actorId: string): boolean {
  const seat = debaterSeat(view, actorId);
  // A seat that left the Round is absent from then on, not in its room (TAB-6.8).
  return (
    isLiveRound(view) &&
    seat !== undefined &&
    !(view.checkpoint !== null && isAbsentSeat(view.checkpoint, seat.id))
  );
}

/** The seat, every other competitor seat, and who sits where, as the room shows them. */
const seatingOf = (view: RoundView, seat: Seat) => ({
  self: debaterOf(view.rules, seat),
  others: seatsOf(view)
    .filter((p) => p.id !== seat.id)
    .map((p) => debaterOf(view.rules, p)),
  groups: seatGroupsOf(view.rules),
  people: view.participants.map(personOf),
});

const segmentKind = (type: SegmentType): SpeechSlot['kind'] => {
  switch (type) {
    case 'speech':
      return 'speech';
    case 'cross_ex':
      return 'cross-ex';
    case 'open':
      return 'open';
  }
};

const speechesOf = (view: RoundView): readonly SpeechSlot[] =>
  view.rules.segments.map((segment, index) => ({
    id: `${index}-${segment.key}`,
    code: segment.key,
    name: segment.label,
    lead: leadSeatOf(segment.speak),
    kind: segmentKind(segment.type),
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

/** Whether this seat may speak in the open segment: a speech's floor, or one of several. */
const speaksIn = (
  view: RoundView,
  open: NonNullable<RoundPosition['openSegment']>,
  seat: SeatRef,
): boolean =>
  open.speak.rights === 'one'
    ? sameTeam(floorSeatOf(view, open), seat)
    : speakingSeatsOf(view.rules, open.speak).some((s) => sameTeam(s, seat));

/** The phase of a live segment: your own floor, a floor you share, or someone else's. */
const livePhaseOf = (
  view: RoundView,
  open: NonNullable<RoundPosition['openSegment']>,
  seat: SeatRef,
): RoundPhase => {
  if (!speaksIn(view, open, seat)) return 'opponent-speaking';
  return open.speak.rights === 'one' ? 'own-speech' : 'cross-ex';
};

/** The phase this debater is in, from the derived position. */
function phaseOf(
  view: RoundView,
  position: RoundPosition,
  seat: SeatRef,
): RoundPhase {
  if (position.status !== 'active') return 'waiting';
  if (position.stage === 'awaiting_ballot') return 'judging';
  if (position.stage === 'prep')
    return position.prep?.side === sideOfSeat(seat) ? 'prep' : 'waiting';
  const open = position.openSegment;
  if (position.stage !== 'live' || !open) return 'waiting';
  return livePhaseOf(view, open, seat);
}

const segmentClock = (
  open: NonNullable<RoundPosition['openSegment']>,
  seat: SeatRef,
) => ({
  label:
    open.type === 'cross_ex'
      ? `Cross-examination · ${sameTeam(open.lead, seat) ? 'You ask' : 'You answer'}`
      : `${open.key} · ${open.label}`,
  remainingMs: open.remainingMs,
});

const prepClock = (
  view: RoundView,
  prep: NonNullable<RoundPosition['prep']>,
  side: SideKey | null,
  micOpens: boolean,
) => ({
  label:
    prep.side === side
      ? 'Your prep'
      : `${sideName(view.rules.sides, prep.side)} prep`,
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
  seat: Seat,
): RoundSnapshot['clock'] {
  if (position.openSegment)
    return segmentClock(position.openSegment, seat.seat);
  // Told before it opens, because the other side can hear it from then. The same decision
  // that opens it, so a cross-examination's two seats are both told.
  const micOpens =
    position.nextSegment !== null &&
    microphoneOpensForClock({
      rules: view.rules,
      participants: view.participants.filter(isSeat),
      participantId: seat.id,
      nextSequence: position.nextSegment.sequence,
    });
  if (position.prep)
    return prepClock(view, position.prep, sideOfSeat(seat.seat), micOpens);
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

const prepOf = (
  view: RoundView,
  position: RoundPosition,
): RoundSnapshot['prep'] => {
  const budget = position.prepBudgetRemainingMs;
  return budget
    ? view.rules.sides.map((side) => ({
        side: side.key,
        label: side.label,
        tone: sideToneOf(view.rules.sides, side.key),
        remainingMs: budget[side.key] ?? 0,
      }))
    : null;
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
  seat: Seat,
  nowMs: number,
): Pick<RoundSnapshot, 'phase' | 'liveIndex' | 'clock' | 'prep'> {
  if (view.status === 'active' && view.checkpoint === null)
    return { phase: 'waiting', liveIndex: -1, clock: null, prep: null };
  const step = view.opening?.step;
  if (step?.step === 'prep')
    return {
      phase: 'prep',
      liveIndex: -1,
      clock: {
        label: 'Prep',
        remainingMs: Math.max(0, instantMs(step.endsAt) - nowMs),
      },
      prep: null,
    };
  const position = positionOf(view, nowMs);
  const phase = phaseOf(view, position, seat.seat);
  return {
    phase,
    liveIndex: liveIndexOf(view, position),
    clock:
      phase !== 'judging'
        ? clockOf(view, position, seat)
        : judgingClockOf(view.waitingOn, nowMs),
    prep: prepOf(view, position),
  };
}

/** A debater of a Round whose post-round call may still be on (ADR 0127). */
export function isCallDebater(
  view: RoundView,
  actorId: string,
  nowMs: number,
): boolean {
  return (
    postRoundCallOffered(view, nowMs) &&
    debaterSeat(view, actorId) !== undefined
  );
}

/**
 * The same room during the post-round call: every speech done, the clock the
 * call's own, and nothing left to command. Null once the call's cap passes.
 */
export function postRoundCallRoundOf(
  view: RoundView,
  actorId: string,
  nowMs: number,
): RoundSnapshot | null {
  const seat = debaterSeat(view, actorId);
  const endsAtMs = postRoundCallEndsAtMs(view);
  if (!seat || endsAtMs === null || nowMs >= endsAtMs) return null;
  const seating = seatingOf(view, seat);
  if (seating.others.length === 0) return null;
  return {
    id: view.id,
    resolution: view.topic ?? drawnTopicLabel,
    competition: view.competitionType,
    phase: 'judging',
    ...seating,
    judge: judgeKindOf(view),
    ballots: null,
    judgingState: null,
    stakes: null,
    speeches: speechesOf(view),
    liveIndex: view.rules.segments.length,
    clock: {
      label: 'Call ends',
      remainingMs: endsAtMs - nowMs,
      note: 'Round over · Not recorded',
    },
    prep: null,
    micLive: true,
    channels: [],
    messages: [],
    agents: [{ id: 'assistant', title: 'Assistant' }],
    agentThreads: {},
    agentPrompts: {},
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
  const seating = seatingOf(view, seat);
  if (seating.others.length === 0) return null;
  const { phase, ...clocks } = liveParts(view, seat, nowMs);
  return {
    id: view.id,
    resolution: view.topic ?? drawnTopicLabel,
    competition: view.competitionType,
    phase,
    ...seating,
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
