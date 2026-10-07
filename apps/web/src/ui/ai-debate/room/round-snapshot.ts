import type { DebateSide } from '@daisy/protocol';
import {
  segmentAt,
  type AiDebateView,
  type UiState,
} from '../../../features/ai-debate/context';
import type { Side, SpeechSlot } from '../../../features/debate-room/documents';
import type { RoundPhase } from '../../../features/debate-room/layout';
import type { TranscriptSegment } from '../../../features/debate-room/transcript';
import type { Debater, RoundSnapshot } from '../../debate-room/round';

const sideOf = (side: DebateSide): Side =>
  side === 'affirmative' ? 'aff' : 'neg';

/** The round's resolved schedule as the room's speeches. */
export const speechesOf = (view: AiDebateView): readonly SpeechSlot[] =>
  view.rules.segments.map((segment, index) => ({
    id: `t${index}`,
    code: segment.key,
    side: sideOf(segment.side),
    kind: segment.type === 'cross_ex' ? 'cross-ex' : 'speech',
    durationMs: segment.durationMs,
  }));

const segmentIndexOf = (state: UiState) =>
  'segmentIndex' in state ? state.segmentIndex : null;

/** Which way the room leans: who holds the floor in the current segment. */
export function phaseOf(
  state: UiState,
  view: AiDebateView,
  personSide: DebateSide,
): RoundPhase {
  if (state.phase === 'prep') return 'prep';
  const index = segmentIndexOf(state);
  if (index === null) return 'prep';
  const segment = segmentAt(view, index);
  if (segment.kind === 'cross-examination') return 'cross-ex';
  return segment.side === personSide ? 'own-speech' : 'opponent-speaking';
}

function clockOf(state: UiState, view: AiDebateView): RoundSnapshot['clock'] {
  if (state.phase === 'prep')
    return { label: 'Your prep', remainingMs: state.remainingMs };
  if (state.phase === 'countdown')
    return {
      label: `${segmentAt(view, state.segmentIndex).name} starts in`,
      remainingMs: state.remainingMs,
    };
  if (state.phase === 'live')
    return {
      label: segmentAt(view, state.segmentIndex).name,
      remainingMs: state.remainingMs,
    };
  return {
    label: state.phase === 'waiting' ? 'Not started' : 'Debate over',
    remainingMs: 0,
  };
}

/** Each line, timed from the first line of its segment. */
export function transcriptOf(view: AiDebateView): readonly TranscriptSegment[] {
  const firstAt = new Map<number, number>();
  for (const line of view.utterances)
    if (!firstAt.has(line.segmentIndex))
      firstAt.set(line.segmentIndex, line.at);
  return view.utterances
    .filter((line) => line.text.trim() !== '')
    .map((line) => ({
      id: line.id,
      speechId: `t${line.segmentIndex}`,
      offsetMs: line.at - (firstAt.get(line.segmentIndex) ?? line.at),
      text: line.text,
    }));
}

/**
 * A bot round as the room's snapshot. Bot rounds are practice: no chat,
 * no channels, no agents; documents come from the server separately.
 */
export function botRoundSnapshot(input: {
  readonly view: AiDebateView;
  readonly state: UiState;
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
  const index = segmentIndexOf(state);
  const prepLeft = state.phase === 'prep' ? state.remainingMs : 0;
  const speeches = speechesOf(view);
  return {
    resolution: view.resolution,
    kind: 'unrated',
    phase: phaseOf(state, view, view.personSide),
    self: person,
    opponent,
    speeches,
    liveIndex: index ?? (state.phase === 'waiting' ? -1 : speeches.length),
    clock: clockOf(state, view),
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
