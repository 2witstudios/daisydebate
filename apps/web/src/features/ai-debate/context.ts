import type { Ballot, OpenRouter, TranscriptEntry } from '@daisy/ai-voice';
import type { Clock, IdGenerator } from '@daisy/clock';
import type {
  AiDebateCommandRecord,
  AiDebateRecord,
  Database,
} from '@daisy/db';
import {
  deriveAiDebate,
  aiDebateTurns,
  turnRoles,
  type AiDebateCommand,
  type AiDebateSide,
  type AiDebateState,
  type AiDebateTurn,
} from '@daisy/debate-engine';
import { createAppError } from '@daisy/errors';
import { opponentFor } from './opponents';

export type AiDebateStore = Pick<
  Database,
  | 'createAiDebate'
  | 'getAiDebate'
  | 'appendAiDebateCommand'
  | 'appendAiDebateUtterance'
  | 'replaceAiDebateUtterance'
  | 'recordAiDebateUsage'
  | 'reserveAiDebateSpeech'
  | 'finishAiDebate'
  | 'saveAiDebateBallot'
>;

export type AiDebateVoice = Pick<
  OpenRouter,
  'complete' | 'stream' | 'speak' | 'transcribe'
>;

export type AiDebateDependencies = {
  readonly store: AiDebateStore;
  /** The voice layer; throws INFRASTRUCTURE when AI debates are unavailable. */
  readonly voice: () => AiDebateVoice;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly limits?: {
    /** AI debates live at once, across everyone. */
    readonly live: number;
    /** AI debates one person may start counting per rolling day. */
    readonly perDay: number;
    /** Characters of voice one debate may buy; see `SPEECH_BUDGET`. */
    readonly speechCharacters?: number;
  };
};

/** A chunk of recorded speech from the browser. */
export type AudioFormat = 'webm' | 'ogg' | 'mp4' | 'wav';

/** What the browser needs to run and show the debate. */
export type AiDebateView = {
  readonly id: string;
  readonly resolution: string;
  readonly personSide: AiDebateSide;
  /** The Train bot debated. */
  readonly opponent: string;
  readonly voice: string;
  readonly serverNow: number;
  readonly commands: readonly AiDebateCommand[];
  readonly utterances: readonly {
    readonly id: string;
    readonly turnIndex: number;
    readonly role: 'person' | 'ai';
    readonly text: string;
    /** When the line was recorded, in epoch milliseconds. */
    readonly at: number;
  }[];
  readonly ballot: Ballot | null;
};

/** Speech captured just before a turn ended still arrives after it. */
const GRACE_MS = 3_000;

export const nowMs = (clock: Clock) => Date.parse(clock.now());

export const toEngine = (command: AiDebateCommandRecord): AiDebateCommand => {
  const at = command.at.getTime();
  if (command.type === 'yield')
    return { type: 'yield', at, turnIndex: command.turnIndex };
  if (command.type === 'abort')
    return { type: 'abort', at, reason: command.reason };
  return { type: command.type, at };
};

export const stateAt = (record: AiDebateRecord, at: number): AiDebateState =>
  deriveAiDebate({
    personSide: record.personSide,
    commands: record.commands.map(toEngine),
    now: at,
  });

/** The opponent's persona; the default debater if its bot has gone. */
export const personaOf = (record: AiDebateRecord): string | undefined =>
  opponentFor(record.opponent)?.persona;

export const aiSideOf = (record: AiDebateRecord): AiDebateSide =>
  record.personSide === 'affirmative' ? 'negative' : 'affirmative';

export const transcriptOf = (record: AiDebateRecord): TranscriptEntry[] =>
  record.utterances
    .filter((utterance) => utterance.text.trim().length > 0)
    .map(({ turnIndex, role, text }) => ({ turnIndex, role, text }));

/**
 * True when `turnIndex` is live now, or was until the grace period ago, or
 * (when `early`) is counting down: the AI prepares its words in the
 * countdown so it speaks the moment the turn begins.
 */
const isOpenTurn = (
  record: AiDebateRecord,
  turnIndex: number,
  now: number,
  early: boolean,
) =>
  [now, now - GRACE_MS].some((at) => {
    const state = stateAt(record, at);
    const open =
      state.phase === 'live' || (early && state.phase === 'countdown');
    return open && state.turnIndex === turnIndex;
  });

/** The actor's own AI debate, or NOT_FOUND (never another person's). */
export const ownedBy = async (
  store: AiDebateStore,
  actorId: string,
  id: string,
) => {
  const record = await store.getAiDebate(id);
  if (!record || record.actorId !== actorId) throw createAppError('NOT_FOUND');
  return record;
};

/**
 * The live turn, refusing when it is not live or not the caller's kind.
 * `early` also accepts the turn's countdown (AI work only, never the
 * person's speech).
 */
export const requireLiveTurn = (
  record: AiDebateRecord,
  turnIndex: number,
  now: number,
  allowed: (roles: ReturnType<typeof turnRoles>, kind: string) => boolean,
  { early = false }: { readonly early?: boolean } = {},
): AiDebateTurn => {
  const turn = aiDebateTurns[turnIndex];
  if (!turn || !isOpenTurn(record, turnIndex, now, early))
    throw createAppError('CONFLICT', 'That turn is not live');
  if (!allowed(turnRoles(turn, record.personSide), turn.kind))
    throw createAppError('CONFLICT', 'Not your turn');
  return turn;
};

/** A rough token count for usage when a stream reports none. */
export const approximateTokens = (characters: number) =>
  Math.ceil(characters / 4);
