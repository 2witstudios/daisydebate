import { instantMs } from '@daisy/clock';
import {
  drawnTopicLabel,
  speechInSentence,
} from '../../features/debate-room/vocabulary';
import {
  roundPositionAt,
  speakingParticipants,
  type RoundPosition,
} from '@daisy/debate-engine/position';
import {
  postRoundCallEndsAtMs,
  postRoundCallOffered,
} from '../../features/post-round-call/offered';
import { microphoneOpensForClock } from '@daisy/debate-engine/media-grants';
import { isAbsentSeat } from '@daisy/protocol/round';
import { leadSeatOf, speakingSeatsOf } from '@daisy/protocol/format-seating';
import {
  sameSeat,
  sideOfSeat,
  type SeatRef,
  type SideKey,
} from '@daisy/protocol/seats';
import { isNamedSeat, type RoundView } from '@daisy/protocol/round-view';
import { type SegmentType } from '@daisy/protocol/format';
import {
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

/** Whether this seat's team has the open segment: its speech, or one it shares. */
const speaksIn = (
  view: RoundView,
  open: NonNullable<RoundPosition['openSegment']>,
  seat: SeatRef,
): boolean =>
  open.speak.rights === 'one'
    ? sameTeam(open.lead, seat)
    : speakingSeatsOf(view.rules, open.speak).some((s) => sameTeam(s, seat));

/**
 * Whether this exact seat's microphone is granted now, by the server's own
 * rule (INTX-12): a speech's seat or an accepted point's holder, or a seat a
 * shared segment names, and never a seat that has left. A partner's speech is
 * not their microphone.
 */
const micGranted = (
  view: RoundView,
  position: RoundPosition,
  seat: Seat,
): boolean => {
  const open = position.openSegment;
  if (position.stage !== 'live' || !open) return false;
  return speakingParticipants(
    view.rules,
    view.participants.filter(isNamedSeat),
    open.sequence,
    position.pointOfInformation?.holder?.participantId ?? null,
    view.checkpoint?.absent_participant_ids ?? [],
  ).includes(seat.id);
};

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
    return position.prep?.phase === 'running' &&
      position.prep.side === sideOfSeat(seat)
      ? 'prep'
      : 'waiting';
  const open = position.openSegment;
  if (position.stage !== 'live' || !open) return 'waiting';
  return livePhaseOf(view, open, seat);
}

const segmentClock = (
  open: NonNullable<RoundPosition['openSegment']>,
  seat: SeatRef,
): NonNullable<RoundSnapshot['clock']> => ({
  label:
    open.type === 'cross_ex'
      ? `Cross-examination · ${sameTeam(open.lead, seat) ? 'You ask' : 'You answer'}`
      : `${open.key} · ${open.label}`,
  remainingMs: open.remainingMs,
});

const prepClock = (
  view: RoundView,
  prep: Extract<NonNullable<RoundPosition['prep']>, { phase: 'running' }>,
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
  if (position.openSegment) {
    const clock = segmentClock(position.openSegment, seat.seat);
    // A point of information runs on the speech's clock; say so beside it.
    return position.pointOfInformation?.holder
      ? { ...clock, note: 'The speech clock keeps running during the POI' }
      : clock;
  }
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
  if (position.prep?.phase === 'running')
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
        ended: position.prepExpired,
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
): Pick<
  RoundSnapshot,
  'phase' | 'liveIndex' | 'clock' | 'prep' | 'micLive' | 'point' | 'prepCalled'
> {
  const quiet = { micLive: false, point: null, prepCalled: null } as const;
  if (view.status === 'active' && view.checkpoint === null)
    return {
      phase: 'waiting',
      liveIndex: -1,
      clock: null,
      prep: null,
      ...quiet,
    };
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
      ...quiet,
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
    micLive: micGranted(view, position, seat),
    point: pointOf(view, position, seat, nowMs),
    prepCalled: prepCalledOf(view, position, seat),
  };
}

const labelOf = (view: RoundView, participantId: string) =>
  view.participants.filter(isSeat).find((p) => p.id === participantId)?.label ??
  'A debater';

/** The open speech's points of information as this seat sees them (INTX-18). */
function pointOf(
  view: RoundView,
  position: RoundPosition,
  seat: Seat,
  nowMs: number,
): RoundSnapshot['point'] {
  const point = position.pointOfInformation;
  const open = position.openSegment;
  if (point === null || open === null) return null;
  const opensInMs = Math.max(0, instantMs(point.offersOpenAt) - nowMs);
  const closed = nowMs >= instantMs(point.offersCloseAt);
  const holder = point.holder;
  const role: NonNullable<RoundSnapshot['point']>['role'] =
    open.lead !== null && sameSeat(open.lead, seat.seat)
      ? 'speaker'
      : holder?.participantId === seat.id
        ? 'holder'
        : point.offers.some((offer) => offer.participantId === seat.id)
          ? 'offering'
          : 'audience';
  return {
    role,
    window:
      opensInMs > 0 ? 'protected-start' : closed ? 'protected-end' : 'open',
    opensInMs,
    offers: point.offers.map((offer) => ({
      participantId: offer.participantId,
      name: labelOf(view, offer.participantId),
      lapsesInMs: Math.max(0, instantMs(offer.lapsesAt) - nowMs),
    })),
    ownOfferLapsesInMs: (() => {
      const own = point.offers.find((offer) => offer.participantId === seat.id);
      return own ? Math.max(0, instantMs(own.lapsesAt) - nowMs) : null;
    })(),
    holder: holder
      ? {
          participantId: holder.participantId,
          name: labelOf(view, holder.participantId),
          remainingMs: holder.remainingMs,
        }
      : null,
  };
}

/** Prep called during the live segment, for the segment after it (INTX-2). */
function prepCalledOf(
  view: RoundView,
  position: RoundPosition,
  seat: Seat,
): RoundSnapshot['prepCalled'] {
  const prep = position.prep;
  const open = position.openSegment;
  if (prep?.phase !== 'called' || open === null) return null;
  return {
    side: sideName(view.rules.sides, prep.side),
    own: prep.side === sideOfSeat(seat.seat),
    before: speechInSentence(
      view.rules.segments[open.sequence + 1]?.label ?? 'next speech',
    ),
    after: speechInSentence(open.label),
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
    point: null,
    prepCalled: null,
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
    channels: [],
    messages: [],
    agents: [{ id: 'assistant', title: 'Assistant' }],
    agentThreads: {},
    agentPrompts: {},
  };
}
