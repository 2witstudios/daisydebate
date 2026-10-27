import {
  isDefiniteProviderFailure,
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
import type { ProviderCall } from '../../server/provider-budget';

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
/** The scheduled end of the scoped segment, as the generation read it. */
function segmentEndOf(context: Context, scope: BotPublicationScope) {
  const segment = context.round.segments.find(
    (row) => row.id === scope.segmentId,
  );
  return segment
    ? new Date(Date.parse(segment.startedAt) + segment.durationMs).toISOString()
    : null;
}
type Usage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly characters: number;
};
const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, characters: 0 };
/** Only memory phrases/PCM leave this operation; capture owns durable transcript evidence. */
export function createBotGeneration(input: {
  readonly store: Store;
  readonly voice: () => Pick<OpenRouter, 'complete' | 'speakPcm'>;
  readonly withProvider: ProviderCall;
  readonly nowMs: () => number;
  readonly maxTokens: number;
}) {
  if (
    !Number.isSafeInteger(input.maxTokens) ||
    input.maxTokens < 1 ||
    input.maxTokens > 16000
  )
    throw createAppError('VALIDATION');
  const dispatch = <T, P>(
    scope: BotPublicationScope,
    token: string,
    request: Parameters<Producer['beginGeneration']>[2],
    signal: AbortSignal,
    step: {
      /** Builds the provider request; a refusal here never reaches the vendor. */
      readonly buildProviderInput: (context: Context) => P;
      readonly call: (
        voice: ReturnType<typeof input.voice>,
        providerInput: P,
      ) => Promise<{ value: T; usage: Usage }>;
    },
  ) =>
    input.withProvider(signal, async () => {
      requireActive(signal);
      const voice = input.voice();
      const context = await input.store.beginRoundBotGeneration(
        scope,
        token,
        request,
      );
      const finish = (
        outcome: 'received' | 'failed' | 'unknown',
        usage: Parameters<Store['finishRoundBotGeneration']>[3],
      ) =>
        input.store.finishRoundBotGeneration(
          scope,
          context.execution,
          outcome,
          usage,
        );
      let result: { value: T; usage: Usage };
      let sent = false;
      try {
        requireActive(signal);
        const providerInput = step.buildProviderInput(context);
        requireActive(signal);
        sent = true;
        result = await step.call(voice, providerInput);
      } catch (error) {
        // Certainly unserved: settled failed with no usage, which gives the
        // voice characters back. Anything else may have been served.
        if (!sent || isDefiniteProviderFailure(error))
          await finish('failed', NO_USAGE);
        else
          await finish('unknown', {
            ...NO_USAGE,
            characters: request.kind === 'tts' ? request.characters : 0,
          });
        throw error;
      }
      let finished = false;
      return {
        value: result.value,
        /**
         * Records the received usage once, then re-verifies authority. A
         * refused settlement is retried alone: the provider is never asked
         * again for an answer it already gave (ISSUE-431-r4).
         */
        settle: async () => {
          if (!finished) {
            await finish('received', result.usage);
            finished = true;
          }
          requireActive(signal);
          await input.store.verifyRoundBotPublication(scope, token);
        },
      };
    });
  return {
    generate: (
      scope: BotPublicationScope,
      token: string,
      signal: AbortSignal,
    ) =>
      dispatch(scope, token, { kind: 'language' }, signal, {
        buildProviderInput: (context) => ({
          model: context.model,
          messages: messagesFor(context, scope, input.nowMs()),
          maxTokens: input.maxTokens,
          temperature: 0.6,
          reasoning:
            context.round.segments.find((row) => row.id === scope.segmentId)
              ?.type === 'cross_ex'
              ? ('none' as const)
              : ('low' as const),
          signal,
        }),
        call: async (voice, providerInput) => {
          const answer = await voice.complete(providerInput);
          return {
            value: answer.text,
            usage: {
              inputTokens: answer.promptTokens,
              outputTokens: answer.completionTokens,
              characters: 0,
            },
          };
        },
      }).then(({ value: text, settle }) => ({
        value: { text, phrases: phrasesOf(text) },
        // An empty answer is still paid for: its usage settles before it fails the attempt.
        settle: async () => {
          await settle();
          if (!text.trim())
            throw createAppError('INFRASTRUCTURE', 'Empty bot phrase');
        },
      })),
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
        {
          buildProviderInput: (context) => ({
            request: {
              model: context.model,
              voice: context.profile.voice,
              text,
              signal,
            },
            segmentEndsAt: segmentEndOf(context, scope),
          }),
          call: async (voice, { request, segmentEndsAt }) => {
            const audio = await voice.speakPcm(request);
            return {
              value: {
                scope,
                token,
                phraseId,
                text,
                pcm: audio.pcm,
                sampleRate: audio.sampleRate,
                channels: audio.channels,
                ...(segmentEndsAt ? { segmentEndsAt } : {}),
              },
              usage: {
                inputTokens: 0,
                outputTokens: 0,
                characters: audio.characters,
              },
            };
          },
        },
      );
    },
  };
}
