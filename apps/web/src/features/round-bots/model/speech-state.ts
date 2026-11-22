import {
  initialSpeakerState,
  nextSpeakerState,
  type DutyEvent,
  type DutyEffect,
  type DutyRules,
  type SpeakerState,
} from '../duty';

type Voice = {
  readonly index: number;
  readonly lineId: string | null;
} & (
  | { readonly status: 'requested' | 'failed' }
  | {
      readonly status: 'received' | 'settling' | 'settled';
      readonly durationMs: number;
    }
);
type Turn = {
  readonly language: 'empty' | 'requested' | 'received' | 'settled';
  readonly voices: readonly Voice[];
  readonly cursor: number;
  readonly previous: number | null;
  readonly awaiting: number | null;
  readonly voicing: 'open' | 'closed';
  readonly cut: 'unreported' | 'reported';
};
type SpeechState = SpeakerState & {
  readonly generation: number;
  readonly run:
    | { readonly status: 'idle' }
    | {
        readonly status: 'working' | 'publishing';
        readonly stage: 'generate' | 'synthesize' | 'publish';
      };
  readonly turn: Turn;
};
type ReceiptEvent = { readonly generation: number } & (
  | {
      readonly type:
        | 'language-requested'
        | 'language-received'
        | 'language-settled'
        | 'cut-reported'
        | 'phrase-sent'
        | 'tail-cut'
        | 'drop-ahead';
    }
  | {
      readonly type: 'voice-requested';
      readonly index: number;
      readonly lineId: string;
    }
  | {
      readonly type: 'voice-received';
      readonly index: number;
      readonly durationMs: number;
    }
  | {
      readonly type:
        'voice-settled' | 'voice-failed' | 'voice-settling' | 'voice-unsettled';
      readonly index: number;
    }
  | { readonly type: 'line'; readonly index: number; readonly lineId: string }
  | { readonly type: 'await-phrase'; readonly index: number | null }
);
export type SpeechEvent =
  | ReceiptEvent
  | { readonly type: 'reset' }
  | { readonly type: 'run-ended' }
  | {
      readonly type: 'work';
      readonly stage: 'generate' | 'synthesize' | 'publish';
    }
  | { readonly type: 'publishing'; readonly active: boolean }
  | {
      readonly type: 'duty';
      readonly event: DutyEvent;
      readonly rules: DutyRules;
    };
type SpeechWork = {
  readonly type:
    | 'generate'
    | 'settle-language'
    | 'finish'
    | 'voice'
    | 'settle-voice'
    | 'await-voice'
    | 'publish';
};
const emptyTurn = (): Turn => ({
  language: 'empty',
  voices: [],
  cursor: 0,
  previous: null,
  awaiting: null,
  voicing: 'open',
  cut: 'unreported',
});
export const initialSpeechState = (rules: DutyRules): SpeechState => ({
  ...initialSpeakerState(rules),
  generation: 0,
  run: { status: 'idle' },
  turn: emptyTurn(),
});
export const phraseAt = (state: SpeechState, index: number) =>
  state.turn.voices.find((voice) => voice.index === index);
export const hasBought = (state: SpeechState) =>
  state.turn.language !== 'empty';
export const isPublishing = (state: SpeechState) =>
  state.run.status === 'publishing';
export const nextSpeechWork = (
  state: SpeechState,
  input: { readonly text: string | null },
): SpeechWork => {
  if (state.turn.language === 'empty' || state.turn.language === 'requested')
    return { type: 'generate' };
  if (state.turn.language === 'received') return { type: 'settle-language' };
  if (input.text === null) return { type: 'finish' };
  const voice = phraseAt(state, state.turn.cursor);
  if (voice?.status === 'requested' || voice?.status === 'settling')
    return { type: 'await-voice' };
  if (!voice || voice.status === 'failed') return { type: 'voice' };
  return { type: voice.status === 'received' ? 'settle-voice' : 'publish' };
};
/** Bounded lookahead comes from receipt state, never from in-flight promise flags. */
export const voicesToBuy = (state: SpeechState) =>
  state.turn.voicing === 'closed'
    ? []
    : [state.turn.cursor + 1, state.turn.cursor + 2].filter((index) => {
        const voice = phraseAt(state, index);
        return !voice || voice.status === 'failed';
      });
export const openingVoices = (state: SpeechState) => {
  const first = phraseAt(state, 0);
  if (!first || !('durationMs' in first)) return [];
  let durationMs = first.durationMs;
  const waiting: number[] = [];
  for (const index of [1, 2]) {
    if (durationMs >= 4000) break;
    const voice = phraseAt(state, index);
    if (!voice) break;
    waiting.push(index);
    if ('durationMs' in voice) durationMs += voice.durationMs;
  }
  return waiting;
};
export function nextSpeechState(
  state: SpeechState,
  event: SpeechEvent,
): { readonly state: SpeechState; readonly effects: readonly DutyEffect[] } {
  if (event.type === 'duty') {
    const next = nextSpeakerState(state, event.event, event.rules);
    return { state: { ...state, ...next.state }, effects: next.effects };
  }
  if (event.type === 'reset')
    return {
      state: { ...state, generation: state.generation + 1, turn: emptyTurn() },
      effects: [],
    };
  if (event.type === 'run-ended')
    return { state: { ...state, run: { status: 'idle' } }, effects: [] };
  if (event.type === 'work')
    return {
      state: { ...state, run: { status: 'working', stage: event.stage } },
      effects: [],
    };
  if (event.type === 'publishing')
    return {
      state: {
        ...state,
        run: {
          status: event.active ? 'publishing' : 'working',
          stage: 'publish',
        },
      },
      effects: [],
    };
  if (event.generation !== state.generation) return { state, effects: [] };
  const { turn } = state;
  const updateVoice = (
    index: number,
    change: (voice: Voice) => Voice,
  ): readonly Voice[] =>
    turn.voices.map((voice) => (voice.index === index ? change(voice) : voice));
  let next = turn;
  switch (event.type) {
    case 'language-requested':
      next =
        turn.language === 'empty' ? { ...turn, language: 'requested' } : turn;
      break;
    case 'language-received':
      next =
        turn.language === 'requested'
          ? { ...turn, language: 'received' }
          : turn;
      break;
    case 'language-settled':
      next =
        turn.language === 'received' ? { ...turn, language: 'settled' } : turn;
      break;
    case 'voice-requested':
      next = {
        ...turn,
        voices: [
          ...turn.voices.filter((voice) => voice.index !== event.index),
          { index: event.index, lineId: event.lineId, status: 'requested' },
        ],
      };
      break;
    case 'voice-received':
      next = {
        ...turn,
        voices: updateVoice(event.index, (voice) =>
          voice.status === 'requested'
            ? {
                index: voice.index,
                lineId: voice.lineId,
                status: 'received',
                durationMs: event.durationMs,
              }
            : voice,
        ),
      };
      break;
    case 'voice-settled':
      next = {
        ...turn,
        voices: updateVoice(event.index, (voice) =>
          voice.status === 'received' || voice.status === 'settling'
            ? { ...voice, status: 'settled' }
            : voice,
        ),
      };
      break;
    case 'voice-settling':
      next = {
        ...turn,
        voices: updateVoice(event.index, (voice) =>
          voice.status === 'received'
            ? { ...voice, status: 'settling' }
            : voice,
        ),
      };
      break;
    case 'voice-unsettled':
      next = {
        ...turn,
        voices: updateVoice(event.index, (voice) =>
          voice.status === 'settling'
            ? { ...voice, status: 'received' }
            : voice,
        ),
      };
      break;
    case 'voice-failed':
      next = {
        ...turn,
        voices: updateVoice(event.index, (voice) =>
          voice.status === 'requested'
            ? { index: voice.index, lineId: voice.lineId, status: 'failed' }
            : voice,
        ),
      };
      break;
    case 'line':
      next = {
        ...turn,
        voices: updateVoice(event.index, (voice) => ({
          ...voice,
          lineId: event.lineId,
        })),
      };
      break;
    case 'await-phrase':
      next = { ...turn, awaiting: event.index };
      break;
    case 'phrase-sent':
      next = {
        ...turn,
        cursor: turn.cursor + 1,
        previous: turn.cursor,
        voices: turn.voices.filter((voice) => voice.index >= turn.cursor),
      };
      break;
    case 'tail-cut':
      next =
        turn.previous === null
          ? turn
          : {
              ...turn,
              cursor: turn.previous,
              previous: null,
              voices: updateVoice(turn.previous, (voice) => ({
                ...voice,
                lineId: null,
              })),
            };
      break;
    case 'drop-ahead':
      next = {
        ...turn,
        voicing: 'closed',
        voices: turn.voices.filter((voice) => voice.index <= turn.cursor),
      };
      break;
    case 'cut-reported':
      next = { ...turn, cut: 'reported' };
      break;
  }
  return { state: { ...state, turn: next }, effects: [] };
}
