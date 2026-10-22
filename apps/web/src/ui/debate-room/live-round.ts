import {
  roundPositionAt,
  type RoundPosition,
} from '@daisy/debate-engine/position';
import type { DebateSide, RoundSeat, RoundView } from '@daisy/protocol';
import type {
  Side,
  SpeechSlot,
} from '../../features/debate-room/documents/documents';
import {
  judgingBallotsOf,
  judgingClockOf,
} from '../../features/debate-room/judging';
import type { RoundPhase } from '../../features/debate-room/layout';
import { roundKindOf } from '../../features/debate-room/workspace';
import type { Debater, RoundPerson, RoundSnapshot } from './round';

type Participant = RoundView['participants'][number];
type Seat = RoundSeat & { role: DebateSide };

const sideOf: Readonly<Record<DebateSide, Side>> = {
  affirmative: 'aff',
  negative: 'neg',
};
const sideName: Readonly<Record<DebateSide, string>> = {
  affirmative: 'Aff',
  negative: 'Neg',
};

const live = (view: RoundView) =>
  view.status === 'scheduled' || view.status === 'active';

const isDebater = (p: Participant): p is Seat => p.role !== 'judge';

const debaterSeat = (view: RoundView, actorId: string) =>
  view.participants.filter(isDebater).find((p) => p.actorId === actorId);

/** The round room is for a debater of a round that has not ended. */
export function isLiveDebater(view: RoundView, actorId: string): boolean {
  return live(view) && debaterSeat(view, actorId) !== undefined;
}

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');

const debater = (p: Seat): Debater => ({
  id: p.actorId,
  name: p.label,
  initials: initialsOf(p.label),
  side: sideOf[p.role],
  rating: null,
  bot: p.kind === 'bot' ? { level: null } : null,
});

const person = (p: Participant): RoundPerson =>
  isDebater(p)
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
    side: sideOf[segment.side],
    kind: segment.type === 'cross_ex' ? 'cross-ex' : 'speech',
    durationMs: segment.durationMs,
  }));

const judgeOf = (view: RoundView): RoundSnapshot['judge'] => {
  const judge = view.participants.find((p) => p.role === 'judge');
  if (!judge) return null;
  return judge.kind === 'bot' ? 'ai' : 'human';
};

const positionOf = (view: RoundView, nowMs: number): RoundPosition =>
  roundPositionAt({
    round: view,
    segments: view.segments,
    checkpoint: view.checkpoint,
    rules: view.rules,
    nowMs,
  });

/** Who holds the floor: an accepted interruption, else the segment's side. */
const floorSide = (
  view: RoundView,
  open: NonNullable<RoundPosition['openSegment']>,
): DebateSide =>
  view.participants
    .filter(isDebater)
    .find((p) => p.id === open.floorParticipantId)?.role ?? open.side;

/** The phase this debater is in, from the derived position. */
function phaseOf(
  view: RoundView,
  position: RoundPosition,
  side: DebateSide,
): RoundPhase {
  if (position.status !== 'active') return 'waiting';
  if (position.awaitingBallot) return 'judging';
  if (position.stage === 'prep')
    return position.prep?.side === side ? 'prep' : 'waiting';
  const open = position.openSegment;
  if (position.stage !== 'live' || !open) return 'waiting';
  if (open.type === 'cross_ex') return 'cross-ex';
  return floorSide(view, open) === side ? 'own-speech' : 'opponent-speaking';
}

const segmentClock = (
  open: NonNullable<RoundPosition['openSegment']>,
  side: DebateSide,
) => ({
  label:
    open.type === 'cross_ex'
      ? `${open.key} · ${open.side === side ? 'You ask' : 'You answer'}`
      : `${open.key} · ${open.label}`,
  remainingMs: open.remainingMs,
});

const prepClock = (
  prep: NonNullable<RoundPosition['prep']>,
  side: DebateSide,
) => ({
  label: prep.side === side ? 'Your prep' : `${sideName[prep.side]} prep`,
  remainingMs: prep.remainingMs,
});

/** The main clock: the open segment, prep, the countdown, or the first speech's length. */
function clockOf(
  view: RoundView,
  position: RoundPosition,
  side: DebateSide,
): RoundSnapshot['clock'] {
  if (position.openSegment) return segmentClock(position.openSegment, side);
  if (position.prep) return prepClock(position.prep, side);
  if (position.countdownRemainingMs !== null)
    return { label: 'Starts in', remainingMs: position.countdownRemainingMs };
  const first = view.rules.segments[0];
  if (view.status !== 'scheduled' || !first) return null;
  return {
    label: `${first.key} · ${first.label}`,
    remainingMs: first.durationMs,
  };
}

/** The lit speech: the one open, else the one prep or the countdown leads to. */
function liveIndexOf(view: RoundView, position: RoundPosition): number {
  if (position.awaitingBallot) return view.rules.segments.length;
  if (position.openSegment) return position.openSegment.sequence;
  if (position.status !== 'active') return -1;
  return position.nextSegment?.sequence ?? -1;
}

/**
 * Judging-clock display uses the persisted final close when available.
 * Before a durable tick arrives, the scheduled end is a display prediction;
 * capture admission and finalization use the committed database anchor.
 */
const finalCloseMs = (view: RoundView): number => {
  const last = view.segments.at(-1);
  if (!last) return Date.parse(view.startedAt ?? '');
  return last.endedAt === null
    ? Date.parse(last.startedAt) + last.durationMs
    : Date.parse(last.endedAt);
};

const prepOf = (position: RoundPosition): RoundSnapshot['prepMs'] => {
  const budget = position.prepBudgetRemainingMs;
  return budget ? { aff: budget.affirmative, neg: budget.negative } : null;
};

/**
 * The phase, lit speech and clocks at one instant. An active round whose
 * checkpoint could not be read has no live position: waiting, nothing lit,
 * no clock, rather than a position guessed from an empty checkpoint.
 */
function liveParts(
  view: RoundView,
  side: DebateSide,
  nowMs: number,
): Pick<RoundSnapshot, 'phase' | 'liveIndex' | 'clock' | 'prepMs'> {
  if (view.status === 'active' && view.checkpoint === null)
    return { phase: 'waiting', liveIndex: -1, clock: null, prepMs: null };
  const position = positionOf(view, nowMs);
  const phase = phaseOf(view, position, side);
  return {
    phase,
    liveIndex: liveIndexOf(view, position),
    clock:
      phase === 'judging'
        ? judgingClockOf(finalCloseMs(view), nowMs)
        : clockOf(view, position, side),
    prepMs: prepOf(position),
  };
}

/**
 * One debater's room at one instant, derived from the round's durable
 * snapshot with the same reader the server uses. The mic follows the
 * floor (DEC-97). Chat, agents and media have no server yet and start
 * empty.
 */
export function liveRoundOf(
  view: RoundView,
  actorId: string,
  nowMs: number,
): RoundSnapshot | null {
  const seat = debaterSeat(view, actorId);
  if (!live(view) || !seat) return null;
  const opponent = view.participants
    .filter(isDebater)
    .find((p) => p.role !== seat.role);
  if (!opponent) return null;
  const { phase, ...clocks } = liveParts(view, seat.role, nowMs);
  return {
    resolution: view.topic,
    competition: view.competitionType,
    phase,
    self: debater(seat),
    opponent: debater(opponent),
    people: view.participants.map(person),
    judge: judgeOf(view),
    ballots: judgingBallotsOf(judgeOf(view)),
    stakes: null,
    recording: false,
    transcribing: false,
    speeches: speechesOf(view),
    ...clocks,
    micLive: phase === 'own-speech' || phase === 'cross-ex',
    voiceLevel: 0,
    clubName: null,
    documents: [],
    channels: [{ id: 'round', title: 'round', scope: 'round' }],
    messages: [],
    agents:
      roundKindOf(view.competitionType) === 'rated'
        ? []
        : [{ id: 'assistant', title: 'Assistant', scope: 'round' }],
    agentThreads: {},
    agentPrompts: {},
    transcript: [],
  };
}
