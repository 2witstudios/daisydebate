import {
  DEFAULT_MODELS,
  DEFAULT_REASONING,
  judgeMessages,
  parseBallot,
  type Ballot,
} from '@daisy/ai-voice';
import {
  acceptAiDebateCommand,
  aiDebateLongestMs,
  type AiDebateCommand,
  type AiDebateSide,
} from '@daisy/debate-engine';
import { createAppError } from '@daisy/errors';
import {
  nowMs,
  ownedBy,
  requireLiveTurn,
  stateAt,
  toEngine,
  transcriptOf,
  type AiDebateDependencies,
  type AiDebateView,
  type AudioFormat,
} from './context';
import { crossExaminationOperations } from './cross-examination';
import { opponentFor } from './opponents';
import { speechOperations } from './speech';

export type { AiDebateView } from './context';

const DEFAULT_LIMITS = { live: 25, perDay: 20 } as const;
/** A created AI debate has this long to start before it stops counting as live. */
const START_WINDOW_MS = 15 * 60_000;

export type PersonCommand =
  | { readonly type: 'start' }
  | { readonly type: 'startSpeech' }
  | { readonly type: 'yield'; readonly turnIndex: number }
  | { readonly type: 'abort' };

const atTime = (command: PersonCommand, at: number): AiDebateCommand => {
  if (command.type === 'yield')
    return { type: 'yield', at, turnIndex: command.turnIndex };
  if (command.type === 'abort') return { type: 'abort', at, reason: 'person' };
  return { type: command.type, at };
};

const asRecord = (command: AiDebateCommand) => {
  const at = new Date(command.at);
  if (command.type === 'yield')
    return { type: 'yield' as const, at, turnIndex: command.turnIndex };
  if (command.type === 'abort')
    return { type: 'abort' as const, at, reason: command.reason };
  return { type: command.type, at };
};

const tidy = (resolution: string) => resolution.trim().replace(/\s+/g, ' ');

/**
 * The AI debate application operations (AIDB): every call names its actor,
 * reads only that actor's own AI debate, and takes time and ids from the
 * injected clock and generator. Speeches and cross-examination live in
 * their own modules and are composed here.
 */
export function createAiDebateOperations(dependencies: AiDebateDependencies) {
  const { store, voice, clock, ids, limits = DEFAULT_LIMITS } = dependencies;

  return {
    ...speechOperations(dependencies),
    ...crossExaminationOperations(dependencies),

    async start({
      actorId,
      resolution,
      personSide,
      opponent: opponentId,
    }: {
      readonly actorId: string;
      readonly resolution: string;
      readonly personSide: AiDebateSide;
      /** The Train bot to debate. */
      readonly opponent: string;
    }): Promise<{ readonly id: string }> {
      const trimmed = tidy(resolution);
      if (trimmed.length < 3 || trimmed.length > 200)
        throw createAppError('VALIDATION', 'Resolution length');
      const opponent = opponentFor(opponentId);
      if (!opponent) throw createAppError('VALIDATION', 'Unknown opponent');
      voice(); // refuse before writing anything when AI debates are unavailable
      const now = nowMs(clock);
      const id = ids.next();
      const created = await store.createAiDebate({
        now: new Date(now),
        limits,
        debate: {
          id,
          actorId,
          resolution: trimmed,
          personSide,
          opponent: opponent.id,
          voice: opponent.voice,
          speechModel: DEFAULT_MODELS.speech,
          cxModel: DEFAULT_MODELS.cx,
          judgeModel: DEFAULT_MODELS.judge,
          ttsModel: DEFAULT_MODELS.tts,
          sttModel: DEFAULT_MODELS.stt,
          // Unstarted, it holds a seat only for the start window.
          expectedEndAt: new Date(now + START_WINDOW_MS),
        },
      });
      if (created !== 'created')
        throw createAppError(
          'RATE_LIMIT',
          created === 'busy'
            ? 'Too many live AI debates'
            : 'Daily AI debate limit',
        );
      return { id };
    },

    async view({
      actorId,
      id,
    }: {
      readonly actorId: string;
      readonly id: string;
    }): Promise<AiDebateView> {
      const record = await ownedBy(store, actorId, id);
      return {
        id: record.id,
        resolution: record.resolution,
        personSide: record.personSide,
        opponent: record.opponent,
        voice: record.voice,
        serverNow: nowMs(clock),
        commands: record.commands.map(toEngine),
        utterances: record.utterances.map(
          ({ id: utteranceId, turnIndex, role, text }) => ({
            id: utteranceId,
            turnIndex,
            role,
            text,
          }),
        ),
        ballot: record.ballot
          ? parseBallot(JSON.stringify(record.ballot.ballot))
          : null,
      };
    },

    /** Appends a timeline command at the server's time, or refuses it. */
    async command({
      actorId,
      id,
      command,
      expectedSequence,
    }: {
      readonly actorId: string;
      readonly id: string;
      readonly command: PersonCommand;
      readonly expectedSequence: number;
    }): Promise<void> {
      const record = await ownedBy(store, actorId, id);
      const now = nowMs(clock);
      if (
        command.type === 'start' &&
        now > record.createdAt.getTime() + START_WINDOW_MS
      )
        throw createAppError('CONFLICT', 'The start window has closed');
      const timed = atTime(command, now);
      const verdict = acceptAiDebateCommand({
        personSide: record.personSide,
        commands: record.commands.map(toEngine),
        command: timed,
      });
      if (!verdict.ok) throw createAppError('CONFLICT', verdict.reason);
      await store.appendAiDebateCommand({
        aiDebateId: id,
        expectedSequence,
        command: asRecord(timed),
        // Once started, it holds its seat until the longest debate ends.
        expectedEndAt:
          timed.type === 'start'
            ? new Date(now + aiDebateLongestMs())
            : undefined,
      });
      if (timed.type === 'abort') await store.finishAiDebate(id);
    },

    /** Transcribes a chunk of the person's speech into the transcript. */
    async transcribe({
      actorId,
      id,
      turnIndex,
      audioBase64,
      format,
    }: {
      readonly actorId: string;
      readonly id: string;
      readonly turnIndex: number;
      readonly audioBase64: string;
      readonly format: AudioFormat;
    }): Promise<{ readonly text: string }> {
      const record = await ownedBy(store, actorId, id);
      requireLiveTurn(record, turnIndex, nowMs(clock), (roles, kind) =>
        kind === 'speech' ? roles.speaker === 'person' : true,
      );
      const { text } = await voice().transcribe({
        model: record.sttModel,
        audioBase64,
        format,
      });
      await store.recordAiDebateUsage({ aiDebateId: id, sttRequests: 1 });
      if (text)
        await store.appendAiDebateUtterance({
          id: ids.next(),
          aiDebateId: id,
          turnIndex,
          role: 'person',
          text,
        });
      return { text };
    },

    /** The judge's ballot, decided once after the last turn. */
    async ballot({
      actorId,
      id,
    }: {
      readonly actorId: string;
      readonly id: string;
    }): Promise<Ballot> {
      const record = await ownedBy(store, actorId, id);
      if (record.ballot)
        return parseBallot(JSON.stringify(record.ballot.ballot));
      if (stateAt(record, nowMs(clock)).phase !== 'ended')
        throw createAppError('CONFLICT', 'The debate is not over');
      const answer = await voice().complete({
        model: record.judgeModel,
        messages: judgeMessages({
          resolution: record.resolution,
          personSide: record.personSide,
          transcript: transcriptOf(record),
        }),
        maxTokens: 6_000,
        temperature: 0.2,
        json: true,
        reasoning: DEFAULT_REASONING.judge,
      });
      await store.recordAiDebateUsage({
        aiDebateId: id,
        promptTokens: answer.promptTokens,
        completionTokens: answer.completionTokens,
      });
      const ballot = parseBallot(answer.text);
      const saved = await store.saveAiDebateBallot({
        aiDebateId: id,
        winner: ballot.winner,
        ballot,
      });
      await store.finishAiDebate(id);
      return parseBallot(JSON.stringify(saved.ballot));
    },
  };
}

export type AiDebateOperations = ReturnType<typeof createAiDebateOperations>;
