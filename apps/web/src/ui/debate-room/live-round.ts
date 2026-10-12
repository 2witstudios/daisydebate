import type { CompetitionType, DebateSide, RoundView } from '@daisy/protocol';
import type {
  Side,
  SpeechSlot,
} from '../../features/debate-room/documents/documents';
import { roundKindOf } from '../../features/debate-room/workspace';
import type { Debater, RoundPerson, RoundSnapshot } from './round';

type Participant = RoundView['participants'][number];

const sideOf: Readonly<Record<DebateSide, Side>> = {
  affirmative: 'aff',
  negative: 'neg',
};

const live = (view: RoundView) =>
  view.status === 'scheduled' || view.status === 'active';

const debaterSeat = (view: RoundView, actorId: string) =>
  view.participants.find((p) => p.actorId === actorId && p.role !== 'judge');

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

const debater = (p: Participant & { role: DebateSide }): Debater => ({
  id: p.actorId,
  name: p.label,
  initials: initialsOf(p.label),
  side: sideOf[p.role],
  rating: null,
});

const isDebater = (p: Participant): p is Participant & { role: DebateSide } =>
  p.role !== 'judge';

/** A human judge's name never reaches the debaters' browsers (DEC-98). */
const person = (p: Participant): RoundPerson =>
  isDebater(p)
    ? {
        id: p.actorId,
        name: p.label,
        role: sideOf[p.role],
        bot: p.kind === 'bot',
      }
    : { id: p.id, name: 'Judge', role: 'judge', bot: p.kind === 'bot' };

const speechesOf = (view: RoundView): readonly SpeechSlot[] =>
  view.rules.segments.map((segment, index) => ({
    id: `${index}-${segment.key}`,
    code: segment.key,
    side: sideOf[segment.side],
    kind: segment.type === 'cross_ex' ? 'cross-ex' : 'speech',
    durationMs: segment.durationMs,
  }));

/** Before the clock starts, the first speech's length and full prep are exact. */
function scheduledClocks(
  view: RoundView,
): Pick<RoundSnapshot, 'clock' | 'prepMs'> {
  const first = view.rules.segments[0];
  const prep = view.rules.inRoundPrep?.budgetMsPerSide;
  if (view.status !== 'scheduled') return { clock: null, prepMs: null };
  return {
    clock: first
      ? {
          label: `${first.key} · ${first.label}`,
          remainingMs: first.durationMs,
        }
      : null,
    prepMs: prep === undefined ? null : { aff: prep, neg: prep },
  };
}

const judgeOf = (view: RoundView): RoundSnapshot['judge'] => {
  const judge = view.participants.find((p) => p.role === 'judge');
  if (!judge) return null;
  return judge.kind === 'bot' ? 'ai' : 'human';
};

/**
 * One debater's room over the durable Launch read. That read carries no
 * live position, so the room shows a waiting round: no speech lit, the
 * first speech's length on a scheduled clock, closed mics, nothing
 * recorded. Chat, agents and media have no server yet and start empty.
 */
export function liveRoundOf(
  view: RoundView,
  competition: CompetitionType,
  actorId: string,
): RoundSnapshot | null {
  const seat = debaterSeat(view, actorId);
  if (!live(view) || !seat || !isDebater(seat)) return null;
  const opponent = view.participants
    .filter(isDebater)
    .find((p) => p.role !== seat.role);
  if (!opponent) return null;
  return {
    resolution: view.topic,
    competition,
    phase: 'waiting',
    self: debater(seat),
    opponent: debater(opponent),
    people: view.participants.map(person),
    judge: judgeOf(view),
    stakes: null,
    recording: false,
    transcribing: false,
    speeches: speechesOf(view),
    liveIndex: -1,
    ...scheduledClocks(view),
    micLive: false,
    clubName: null,
    documents: [],
    channels: [{ id: 'round', title: 'round', scope: 'round' }],
    messages: [],
    agents:
      roundKindOf(competition) === 'rated'
        ? []
        : [{ id: 'assistant', title: 'Assistant', scope: 'round' }],
    agentThreads: {},
    agentPrompts: {},
    transcript: [],
  };
}
