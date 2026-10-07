import type { Ballot, OpenRouter, TranscriptEntry } from '@daisy/ai-voice';
import type { IdGenerator } from '@daisy/clock';
import type { Database, RoundHydration } from '@daisy/db';
import {
  advancedClockRowsOf,
  clockRowsOf,
  roundPositionOf,
  type RoundPosition,
} from '@daisy/debate-engine/position';
import type { RoundRules } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';

/** The usage writes one billable AI call records. */
export type RecordUsage = (
  roundId: string,
  participantId: string,
  actorId: string,
  usage: {
    readonly kind: 'speech' | 'cross_ex' | 'tts' | 'stt' | 'judging';
    readonly model: string;
    readonly inputTokens?: number | undefined;
    readonly outputTokens?: number | undefined;
    readonly characters?: number | undefined;
    readonly requests?: number | undefined;
  },
) => Promise<void>;

/**
 * The command log's payload digest: SHA3-256 over the command's content
 * (ADR 0019). The runtime refuses by state rather than payload, so the
 * type alone is the content today; a payload-carrying command widens this
 * input, never the encoding.
 */
export const digestOf = (command: { readonly type: string }): string => {
  const hasher = new Bun.CryptoHasher('sha3-256');
  hasher.update(command.type);
  return hasher.digest('hex');
};

export type RoundStore = Pick<
  Database,
  | 'databaseNow'
  | 'getFormat'
  | 'createRoom'
  | 'seatRoomParticipant'
  | 'startRound'
  | 'getRound'
  | 'applyRoundExecution'
  | 'applyRoundCompletion'
  | 'appendUtterance'
  | 'replaceUtterance'
  | 'listRoundUtterances'
  | 'submitBallot'
  | 'getBallot'
  | 'recordAgentRun'
  | 'spokenCharactersFor'
  | 'reserveSpokenCharacters'
  | 'reserveAiPractice'
  | 'markReservationCounted'
  | 'countRecentAiPractice'
  | 'countLiveRounds'
  | 'admitAiPractice'
>;

type AiDebateVoice = Pick<
  OpenRouter,
  'complete' | 'stream' | 'speak' | 'transcribe'
>;

export type AiDebateDependencies = {
  readonly store: RoundStore;
  /** The voice layer; throws INFRASTRUCTURE when AI debates are unavailable. */
  readonly voice: () => AiDebateVoice;
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

/** One transcribed line, positioned in the resolved schedule. */
export type AiDebateViewUtterance = {
  readonly id: string;
  /** The line's segment, as its position in `rules.segments`. */
  readonly segmentIndex: number;
  readonly role: 'person' | 'ai';
  readonly text: string;
  readonly complete: boolean;
  /** When the line was recorded, in epoch milliseconds. */
  readonly at: number;
};

/** What the browser needs to run and show the round. */
export type AiDebateView = {
  readonly id: string;
  readonly resolution: string;
  readonly personSide: 'affirmative' | 'negative';
  /** The Train bot debated. */
  readonly opponent: string;
  readonly voice: string;
  readonly serverNow: number;
  /** The round row's optimistic version; every command carries it. */
  readonly version: number;
  readonly status: 'scheduled' | 'active' | 'completed' | 'abandoned';
  readonly startedAt: number | null;
  readonly rules: RoundRules;
  readonly segments: RoundHydration['segments'];
  readonly checkpoint: RoundHydration['checkpoint'];
  readonly utterances: readonly AiDebateViewUtterance[];
  readonly ballot: Ballot | null;
};

/**
 * The side the requesting actor debated.
 *
 * Resolved from that actor's own seat, not from "the first participant who is
 * not the judge". Under the one-Round model a room's seats are authoritative
 * `round_participants` rows and participant reads carry no ordering guarantee,
 * so "first" is whichever row the database happened to return: with a bot in
 * the room the two debaters are symmetric and the bot's seat could answer for
 * the person. Every caller already knows who is asking — the actor id is on
 * every operation — so the seat is looked up rather than guessed.
 *
 * A judge or unseated actor has no person side in the AI practice operation.
 */
export const personSideOf = (
  round: RoundHydration,
  actorId: string,
): 'affirmative' | 'negative' => {
  const seat = round.participants.find(
    (candidate) => candidate.actorId === actorId,
  );
  if (seat?.role !== 'affirmative' && seat?.role !== 'negative')
    throw createAppError('NOT_FOUND');
  return seat.role;
};

/** The person's participant id in their own round. */
export const participantIdOf = (round: RoundHydration, actorId: string) =>
  round.participants.find((seat) => seat.actorId === actorId)?.id ?? '';

export const participantRoleOf = (
  round: RoundHydration,
  participantId: string,
) =>
  round.participants.find((seat) => seat.id === participantId)?.role ?? 'judge';

/** A durable segment row's position in the resolved schedule. */
export const segmentIndexOf = (
  round: RoundHydration,
  segmentId: string,
): number => {
  const row = round.segments.find((segment) => segment.id === segmentId);
  return row ? row.sequence : 0;
};

export const aiSideOf = (personSide: 'affirmative' | 'negative') =>
  personSide === 'affirmative' ? 'negative' : 'affirmative';

/** The transcript the judge reads, in the schedule's order. */
export const transcriptOf = (
  rules: RoundRules,
  utterances: readonly AiDebateViewUtterance[],
): TranscriptEntry[] =>
  utterances
    .filter((utterance) => utterance.text.trim().length > 0)
    .map(({ segmentIndex, role, text }) => ({
      turn: rules.segments[segmentIndex]?.key ?? '?',
      role,
      text,
    }));

/** A rough token count for usage when a stream reports none. */
export const approximateTokens = (characters: number) =>
  Math.ceil(characters / 4);

/**
 * The open segment at `atMs`, refusing when it is not the requested one or
 * not open for the caller. `early` also accepts the segment's countdown
 * (AI preparation only, never the person's speech).
 */
export const requireOpenSegment = (
  position: RoundPosition,
  segmentIndex: number,
  allowed: (segment: {
    readonly side: 'affirmative' | 'negative';
    readonly type: string;
  }) => boolean,
  { early = false }: { readonly early?: boolean } = {},
) => {
  const open = position.openSegment;
  const upcoming = position.nextSegment;
  const segment =
    open ??
    (early && upcoming !== null && position.stage === 'countdown'
      ? upcoming
      : null);
  if (!segment || segment.sequence !== segmentIndex)
    throw createAppError('CONFLICT', 'That segment is not live');
  if (!allowed(segment)) throw createAppError('CONFLICT', 'Not your segment');
  return segment;
};

/**
 * The room UI's view of the round: the runtime position folded into the
 * phases the controls show. `ended` covers both spoken-out-awaiting-the-
 * ballot and completed.
 */
export type UiState =
  | { readonly phase: 'waiting' }
  | {
      readonly phase: 'countdown' | 'prep' | 'live';
      readonly segmentIndex: number;
      readonly remainingMs: number;
    }
  | { readonly phase: 'ended' }
  | { readonly phase: 'aborted' };

/** The gap phase the round is in between segments. */
const gapStateOf = (position: RoundPosition): UiState => {
  if (position.prep !== null)
    return {
      phase: 'prep',
      segmentIndex: position.nextSegment?.sequence ?? 0,
      remainingMs: position.prep.remainingMs,
    };
  return {
    phase: 'countdown',
    segmentIndex: position.nextSegment?.sequence ?? 0,
    remainingMs: position.countdownRemainingMs ?? 0,
  };
};

export const uiStateOf = (position: RoundPosition): UiState => {
  if (position.status === 'scheduled') return { phase: 'waiting' };
  if (position.status === 'abandoned') return { phase: 'aborted' };
  if (position.status === 'completed') return { phase: 'ended' };
  if (position.openSegment !== null)
    return {
      phase: 'live',
      segmentIndex: position.openSegment.sequence,
      remainingMs: position.openSegment.remainingMs,
    };
  if (position.awaitingBallot) return { phase: 'ended' };
  return gapStateOf(position);
};

/** One resolved segment as the room's schedule shows it. */
export type UiSegment = {
  readonly index: number;
  readonly name: string;
  readonly label: string;
  readonly kind: 'speech' | 'cross-examination';
  readonly side: 'affirmative' | 'negative';
  readonly durationMs: number;
};

export const segmentAt = (view: AiDebateView, index: number): UiSegment => {
  const segment = view.rules.segments[index]!;
  return {
    index,
    name: segment.key,
    label: segment.label,
    kind: segment.type === 'cross_ex' ? 'cross-examination' : 'speech',
    side: segment.side,
    durationMs: segment.durationMs,
  };
};

/** The client-visible position at one instant, derived exactly as the server derives it. */
export const positionOfView = (
  view: AiDebateView,
  atMs: number,
): RoundPosition => {
  // The client derives its position from the same pure derivation the
  // server runs, over a read-only view of the durable rows — never through
  // the runtime, whose ECS codegen needs `unsafe-eval` the nonce CSP
  // refuses (ADR 0024 §5).
  const rows = clockRowsOf(view.segments);
  const closed = rows.filter((row) => row.endedAtMs !== null);
  const lastClosed = closed[closed.length - 1];
  const lifecycle = {
    status: view.status,
    startedAtMs: view.startedAt,
    completedAtMs: null,
    outcome: null,
    gapAnchorMs:
      lastClosed !== undefined ? lastClosed.endedAtMs : view.startedAt,
  };
  const advanced = advancedClockRowsOf(
    rows,
    view.checkpoint,
    lifecycle,
    view.rules,
    atMs,
  );
  return roundPositionOf(
    {
      rows: () => advanced.rows,
      openRow: () => advanced.rows.find((row) => row.endedAtMs === null),
      checkpoint: () => advanced.checkpoint,
      lifecycle: () => lifecycle,
    },
    atMs,
    view.rules,
  );
};
