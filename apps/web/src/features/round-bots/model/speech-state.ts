import { isCapacityRefusal } from '@daisy/db/capacity';
import { isFinalBotSpeechRefusal } from '@daisy/db/bot-publication';
import { isAppError } from '@daisy/errors';
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
        /** The speech's hard stop on the monotonic clock, read once per turn. */
        readonly stopAtMs: number | null;
        /**
         * Holding a short opening for the voices after it: the last one
         * confirmed in hand, or done once one is missing or none is owed.
         */
        readonly opening: { readonly through: number } | 'done';
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
  | { readonly type: 'deadline'; readonly atMs: number }
  /** The opening is about to play: its hold starts over. */
  | { readonly type: 'opening-begins' }
  /** The voice the opening waited on is in hand (`held`), or will not be. */
  | {
      readonly type: 'opening-held';
      readonly index: number;
      readonly held: boolean;
    }
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
/** Whether phrase `index`'s voice is in hand: received, settling or settled. */
export const hasVoice = (state: SpeechState, index: number) => {
  const voice = phraseAt(state, index);
  return voice !== undefined && 'durationMs' in voice;
};
/** A phrase needs a new line id when it has none, or its last line was closed. */
export const needsLine = (
  state: SpeechState,
  index: number,
  closed: (lineId: string) => boolean,
) => {
  const lineId = phraseAt(state, index)?.lineId ?? null;
  return lineId === null || closed(lineId);
};
/**
 * The phrase before was reported played whole but a later clear cut its
 * queued tail: the speech steps back to say it again, if the phrase in play
 * is still in hand to follow it.
 */
export const tailWasCut = (
  state: SpeechState,
  cut: (lineId: string) => boolean,
) => {
  const before = state.turn.previous;
  const lineId = before === null ? null : phraseAt(state, before)?.lineId;
  return !!lineId && hasVoice(state, state.turn.cursor) && cut(lineId);
};
/** The speech's hard stop, once read for the turn in play. */
export const stopAt = (state: SpeechState) =>
  state.run.status === 'idle' ? null : state.run.stopAtMs;
/**
 * What a failed turn means for the duty, and whether the failure is
 * reported. A final refusal ends the speech; pool capacity, a platform
 * incident or a full provider budget wait without spending an attempt; a
 * conflict means what was prepared no longer fits; anything else spends one.
 */
export function setbackOf(
  error: unknown,
  facts: {
    readonly busy: boolean;
    /** The bought answer ended before producing any phrase. */
    readonly unusable: boolean;
  },
): { readonly event: DutyEvent; readonly reported: boolean } {
  if (isFinalBotSpeechRefusal(error))
    return { event: { type: 'refused-for-good' }, reported: false };
  const deferred = (authorityChanged: boolean, reported = false) => ({
    event: { type: 'deferred', authorityChanged } as const,
    reported,
  });
  if (isCapacityRefusal(error)) return deferred(false, true);
  if (isAppError(error) && error.reason === 'platform-incident')
    return deferred(false);
  if (facts.busy) return deferred(false);
  if (isAppError(error) && error.code === 'CONFLICT') return deferred(true);
  return {
    event: { type: 'failed', unusable: facts.unusable },
    reported: true,
  };
}
/**
 * What the speaker does: a duty effect, with the duty's own decisions made
 * (a cut silences queued audio only when nothing is being published, a drop
 * applies only between runs, a pause is armed only while the duty is not
 * over), plus the timers and floor waiters a duty change releases.
 */
export type SpeechEffect =
  | Exclude<DutyEffect, 'cut'>
  | 'stop-awaiting-reply'
  | 'stop-pause'
  | 'floor-free';
const dutyEffects = (
  state: SpeechState,
  effects: readonly DutyEffect[],
): readonly SpeechEffect[] => [
  ...(state.duty.status === 'waiting' && state.duty.unanswered
    ? []
    : ['stop-awaiting-reply' as const]),
  ...(state.duty.status === 'owed' && state.duty.paused
    ? []
    : ['stop-pause' as const]),
  ...(state.midTurn.length === 0 ? ['floor-free' as const] : []),
  ...effects.flatMap((effect): SpeechEffect[] => {
    switch (effect) {
      case 'cut':
        return isPublishing(state) ? ['restart'] : ['restart', 'silence'];
      case 'drop':
        return state.run.status === 'idle' ? ['drop'] : [];
      case 'retry-soon':
        return state.duty.status === 'over' ? [] : ['retry-soon'];
      default:
        return [effect];
    }
  }),
];
/**
 * The next voice a short opening waits for before it plays, so the speech
 * never stalls after it, or null once none is owed or one will not come.
 */
export const openingToHold = (state: SpeechState) => {
  const { run } = state;
  if (
    run.status === 'idle' ||
    run.opening === 'done' ||
    state.turn.cursor !== 0
  )
    return null;
  const next = run.opening.through + 1;
  if (
    next > 2 ||
    !openingVoices(state).includes(next) ||
    !phraseAt(state, next)
  )
    return null;
  return next;
};
/** Whether the next phrase must wait for a peer mid-turn to finish (cross-examination). */
export const awaitsFloor = (state: SpeechState, rules: DutyRules) =>
  rules.crossEx && state.midTurn.length > 0;
/** What a publish's outcome means for the speech. */
export const phraseVerdict = (outcome: {
  readonly complete: boolean;
  readonly segmentEnded: boolean;
}) =>
  outcome.segmentEnded
    ? 'segment-ended'
    : outcome.complete
      ? 'said'
      : 'stopped';
/** Whether an answer that stopped short is still to be reported. */
export const reportsCut = (state: SpeechState, cut: boolean) =>
  cut && state.turn.cut === 'unreported';
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
): { readonly state: SpeechState; readonly effects: readonly SpeechEffect[] } {
  if (event.type === 'duty') {
    const next = nextSpeakerState(state, event.event, event.rules);
    const after = { ...state, ...next.state };
    return { state: after, effects: dutyEffects(after, next.effects) };
  }
  if (event.type === 'reset')
    return {
      state: { ...state, generation: state.generation + 1, turn: emptyTurn() },
      effects: [],
    };
  if (event.type === 'run-ended')
    return { state: { ...state, run: { status: 'idle' } }, effects: [] };
  const stopAtMs = stopAt(state);
  const opening =
    state.run.status === 'idle' ? { through: 0 } : state.run.opening;
  if (event.type === 'work')
    return {
      state: {
        ...state,
        run: { status: 'working', stage: event.stage, stopAtMs, opening },
      },
      effects: [],
    };
  if (event.type === 'publishing')
    return {
      state: {
        ...state,
        run: {
          status: event.active ? 'publishing' : 'working',
          stage: 'publish',
          stopAtMs,
          opening,
        },
      },
      effects: [],
    };
  if (event.type === 'opening-begins' || event.type === 'opening-held') {
    if (state.run.status === 'idle') return { state, effects: [] };
    const held =
      event.type === 'opening-begins'
        ? { through: 0 }
        : event.held
          ? { through: event.index }
          : ('done' as const);
    return {
      state: { ...state, run: { ...state.run, opening: held } },
      effects: [],
    };
  }
  if (event.type === 'deadline')
    return {
      state:
        state.run.status === 'idle'
          ? state
          : { ...state, run: { ...state.run, stopAtMs: event.atMs } },
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
