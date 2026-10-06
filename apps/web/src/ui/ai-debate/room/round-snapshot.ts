import {
  aiDebateTurns,
  turnRoles,
  type AiDebateSide,
  type AiDebateState,
} from '@daisy/debate-engine';
import type { AiDebateView } from '../../../features/ai-debate/operations';
import type { Side, SpeechSlot } from '../../../features/debate-room/documents';
import type { RoundPhase } from '../../../features/debate-room/layout';
import type { TranscriptSegment } from '../../../features/debate-room/transcript';
import type { Debater, RoundSnapshot } from '../../debate-room/round';

const sideOf = (side: AiDebateSide): Side =>
  side === 'affirmative' ? 'aff' : 'neg';

/** The bot round's seven turns as the room's speeches. */
export const botSpeeches: readonly SpeechSlot[] = aiDebateTurns.map((turn) => ({
  id: `t${turn.index}`,
  code: turn.name,
  side: sideOf(turn.side),
  kind: turn.kind === 'cross-examination' ? 'cross-ex' : 'speech',
  durationMs: turn.durationMs,
}));

const turnOf = (state: AiDebateState) =>
  'turnIndex' in state ? state.turnIndex : null;

/** Which way the room leans: who holds the floor in the current turn. */
export function phaseOf(
  state: AiDebateState,
  personSide: AiDebateSide,
): RoundPhase {
  if (state.phase === 'prep') return 'prep';
  const index = turnOf(state);
  if (index === null) return 'prep';
  const turn = aiDebateTurns[index]!;
  if (turn.kind === 'cross-examination') return 'cross-ex';
  return turnRoles(turn, personSide).speaker === 'person'
    ? 'own-speech'
    : 'opponent-speaking';
}

function clockOf(state: AiDebateState): RoundSnapshot['clock'] {
  if (state.phase === 'prep')
    return { label: 'Your prep', remainingMs: state.prepLeftMs };
  if (state.phase === 'countdown')
    return {
      label: `${aiDebateTurns[state.turnIndex]!.name} starts in`,
      remainingMs: state.remainingMs,
    };
  if (state.phase === 'live')
    return {
      label: aiDebateTurns[state.turnIndex]!.name,
      remainingMs: state.remainingMs,
    };
  return {
    label: state.phase === 'waiting' ? 'Not started' : 'Debate over',
    remainingMs: 0,
  };
}

/** Each line, timed from the first line of its turn (the view has no turn start). */
export function transcriptOf(view: AiDebateView): readonly TranscriptSegment[] {
  const firstAt = new Map<number, number>();
  for (const line of view.utterances)
    if (!firstAt.has(line.turnIndex)) firstAt.set(line.turnIndex, line.at);
  return view.utterances
    .filter((line) => line.text.trim() !== '')
    .map((line) => ({
      id: line.id,
      speechId: `t${line.turnIndex}`,
      offsetMs: line.at - (firstAt.get(line.turnIndex) ?? line.at),
      text: line.text,
    }));
}

/**
 * A bot round as the room's snapshot. Bot rounds are practice: no chat,
 * no channels, no agents; documents come from the server separately.
 */
export function botRoundSnapshot(input: {
  readonly view: AiDebateView;
  readonly state: AiDebateState;
  readonly bot: { readonly id: string; readonly name: string };
  readonly listening: boolean;
}): RoundSnapshot {
  const { view, state, bot } = input;
  const self = sideOf(view.personSide);
  const other: Side = self === 'aff' ? 'neg' : 'aff';
  const person: Debater = {
    id: 'person',
    name: 'You',
    initials: 'You',
    side: self,
    rating: 0,
  };
  const opponent: Debater = {
    id: bot.id,
    name: bot.name,
    initials: bot.name.slice(0, 2),
    side: other,
    rating: 0,
  };
  const index = turnOf(state);
  const prepLeft = 'prepLeftMs' in state ? state.prepLeftMs : 0;
  return {
    resolution: view.resolution,
    kind: 'unrated',
    phase: phaseOf(state, view.personSide),
    self: person,
    opponent,
    speeches: botSpeeches,
    liveIndex: index ?? (state.phase === 'waiting' ? -1 : botSpeeches.length),
    clock: clockOf(state),
    prepMs: { [self]: prepLeft, [other]: 0 } as Record<Side, number>,
    micLive: input.listening,
    clubName: null,
    documents: [],
    channels: [],
    messages: [],
    agents: [],
    agentThreads: {},
    agentPrompts: {},
    transcript: transcriptOf(view),
  };
}
