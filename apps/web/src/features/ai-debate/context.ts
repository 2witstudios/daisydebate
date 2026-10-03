import type { Ballot, OpenRouter, TranscriptEntry } from '@daisy/ai-voice';
import type { Clock, IdGenerator } from '@daisy/clock';
import type {
  AiDebateCommandRecord,
  AiDebateRecord,
  Database,
} from '@daisy/db';
import {
  deriveAiDebate,
  ipdaTurns,
  turnRoles,
  type AiDebateCommand,
  type AiDebateSide,
  type AiDebateState,
  type AiDebateTurn,
} from '@daisy/debate-engine';
import { createAppError } from '@daisy/errors';

export type AiDebateStore = Pick<
  Database,
  | 'createAiDebate'
  | 'getAiDebate'
  | 'appendAiDebateCommand'
  | 'appendAiDebateUtterance'
  | 'replaceAiDebateUtterance'
  | 'recordAiDebateUsage'
  | 'finishAiDebate'
  | 'saveAiDebateBallot'
  | 'countLiveAiDebates'
  | 'countCountedAiDebates'
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
  };
};

/** A chunk of recorded speech from the browser. */
export type AudioFormat = 'webm' | 'ogg' | 'mp4' | 'wav';

/** What the browser needs to run and show the debate. */
export type AiDebateView = {
  readonly id: string;
  readonly resolution: string;
  readonly personSide: AiDebateSide;
  readonly voice: string;
  readonly serverNow: number;
  readonly commands: readonly AiDebateCommand[];
  readonly utterances: readonly {
    readonly id: string;
    readonly turnIndex: number;
    readonly role: 'person' | 'ai';
    readonly text: string;
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

export const aiSideOf = (record: AiDebateRecord): AiDebateSide =>
  record.personSide === 'affirmative' ? 'negative' : 'affirmative';

export const transcriptOf = (record: AiDebateRecord): TranscriptEntry[] =>
  record.utterances
    .filter((utterance) => utterance.text.trim().length > 0)
    .map(({ turnIndex, role, text }) => ({ turnIndex, role, text }));

/** True when `turnIndex` is live now, or was until the grace period ago. */
const isLiveTurn = (record: AiDebateRecord, turnIndex: number, now: number) =>
  [now, now - GRACE_MS].some((at) => {
    const state = stateAt(record, at);
    return state.phase === 'live' && state.turnIndex === turnIndex;
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

/** The live turn, refusing when it is not live or not the caller's kind. */
export const requireLiveTurn = (
  record: AiDebateRecord,
  turnIndex: number,
  now: number,
  allowed: (roles: ReturnType<typeof turnRoles>, kind: string) => boolean,
): AiDebateTurn => {
  const turn = ipdaTurns[turnIndex];
  if (!turn || !isLiveTurn(record, turnIndex, now))
    throw createAppError('CONFLICT', 'That turn is not live');
  if (!allowed(turnRoles(turn, record.personSide), turn.kind))
    throw createAppError('CONFLICT', 'Not your turn');
  return turn;
};

/** A rough token count for usage when a stream reports none. */
export const approximateTokens = (characters: number) =>
  Math.ceil(characters / 4);
