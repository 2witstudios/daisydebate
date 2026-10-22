import {
  phrasesOf,
  roundDebaterMessages,
  type OpenRouter,
} from '@daisy/ai-voice';
import type {
  createBotPublicationOperations,
  BotPublicationScope,
} from '@daisy/db/bot-publication';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { ProviderCapacity } from '../round-judging/operations';

type Producer = ReturnType<typeof createBotPublicationOperations>;
type Context = Awaited<ReturnType<Producer['beginGeneration']>>;
type Store = {
  readonly beginRoundBotGeneration: Producer['beginGeneration'];
  readonly finishRoundBotGeneration: Producer['finishGeneration'];
  readonly verifyRoundBotPublication: Producer['verifyBotPublication'];
};
function requireActive(signal: AbortSignal) {
  if (signal.aborted) throw createAppError('CONFLICT', 'Generation cancelled');
}
function messagesFor(
  context: Context,
  scope: BotPublicationScope,
  nowMs: number,
) {
  const { round, seat, profile } = context;
  const segment = round.segments.find((row) => row.id === scope.segmentId);
  const rule = round.rules.segments.find(
    (row) => row.key === segment?.rulesSegmentKey,
  );
  if (!segment || !rule || seat.role === 'judge' || !Number.isFinite(nowMs))
    throw createAppError('CONFLICT');
  const durationMs = Date.parse(segment.startedAt) + segment.durationMs - nowMs;
  if (durationMs <= 0) throw createAppError('CONFLICT');
  return roundDebaterMessages({
    resolution: round.resolution,
    side: seat.role,
    slot: seat.slot,
    persona: `${profile.name}. ${profile.persona} Debate difficulty: ${profile.difficulty}.`,
    segment: {
      name: rule.key,
      label: rule.label,
      type: segment.type,
      durationMs,
    },
    transcript: context.utterances.flatMap((line) => {
      const speaker = round.participants.find(
        (row) => row.id === line.roundParticipantId,
      );
      const spoken = round.segments.find((row) => row.id === line.segmentId);
      return speaker && speaker.role !== 'judge' && spoken
        ? [
            {
              side: speaker.role,
              slot: speaker.slot,
              segment: spoken.rulesSegmentKey,
              text: line.text,
              complete: line.complete,
            },
          ]
        : [];
    }),
  });
}
/** Only memory phrases/PCM leave this operation; capture owns durable transcript evidence. */
export function createBotGeneration(input: {
  readonly store: Store;
  readonly voice: () => Pick<OpenRouter, 'complete' | 'speakPcm'>;
  readonly withProvider: ProviderCapacity;
  readonly nowMs: () => number;
  readonly maxTokens: number;
}) {
  if (
    !Number.isSafeInteger(input.maxTokens) ||
    input.maxTokens < 1 ||
    input.maxTokens > 16000
  )
    throw createAppError('VALIDATION');
  const dispatch = <T>(
    scope: BotPublicationScope,
    token: string,
    request: Parameters<Producer['beginGeneration']>[2],
    signal: AbortSignal,
    work: (
      voice: ReturnType<typeof input.voice>,
      context: Context,
    ) => Promise<{
      value: T;
      usage: { inputTokens: number; outputTokens: number; characters: number };
    }>,
  ) =>
    input.withProvider(signal, async () => {
      requireActive(signal);
      const voice = input.voice();
      const context = await input.store.beginRoundBotGeneration(
        scope,
        token,
        request,
      );
      let settled = false;
      try {
        requireActive(signal);
        const result = await work(voice, context);
        await input.store.finishRoundBotGeneration(
          scope,
          context.execution,
          'received',
          result.usage,
        );
        settled = true;
        requireActive(signal);
        await input.store.verifyRoundBotPublication(scope, token);
        return result.value;
      } catch (error) {
        if (!settled)
          await input.store.finishRoundBotGeneration(
            scope,
            context.execution,
            'unknown',
            {
              inputTokens: 0,
              outputTokens: 0,
              characters: request.kind === 'tts' ? request.characters : 0,
            },
          );
        throw error;
      }
    });
  return {
    generate: (
      scope: BotPublicationScope,
      token: string,
      signal: AbortSignal,
    ) =>
      dispatch(
        scope,
        token,
        { kind: 'language' },
        signal,
        async (voice, context) => {
          const answer = await voice.complete({
            model: context.model,
            messages: messagesFor(context, scope, input.nowMs()),
            maxTokens: input.maxTokens,
            temperature: 0.6,
            reasoning:
              context.round.segments.find((row) => row.id === scope.segmentId)
                ?.type === 'cross_ex'
                ? 'none'
                : 'low',
            signal,
          });
          return {
            value: answer.text,
            usage: {
              inputTokens: answer.promptTokens,
              outputTokens: answer.completionTokens,
              characters: 0,
            },
          };
        },
      ).then((text) => {
        if (!text.trim())
          throw createAppError('INFRASTRUCTURE', 'Empty bot phrase');
        return { text, phrases: phrasesOf(text) };
      }),
    synthesize: (
      scope: BotPublicationScope,
      token: string,
      phraseId: string,
      text: string,
      signal: AbortSignal,
    ) => {
      if (
        !idSchema.safeParse(phraseId).success ||
        !text.trim() ||
        text.length > 4000
      )
        throw createAppError('VALIDATION');
      return dispatch(
        scope,
        token,
        { kind: 'tts', characters: text.length },
        signal,
        async (voice, context) => {
          const audio = await voice.speakPcm({
            model: context.model,
            voice: context.profile.voice,
            text,
            signal,
          });
          return {
            value: {
              scope,
              token,
              phraseId,
              text,
              pcm: audio.pcm,
              sampleRate: audio.sampleRate,
              channels: audio.channels,
            },
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              characters: audio.characters,
            },
          };
        },
      );
    },
  };
}
