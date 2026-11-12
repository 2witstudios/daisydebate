import {
  createPhraseStream,
  isDefiniteProviderFailure,
  roundDebaterMessages,
  type OpenRouter,
} from '@daisy/ai-voice';
import type {
  createBotPublicationOperations,
  BotPublicationScope,
} from '@daisy/db/bot-publication';
import { createAppError } from '@daisy/errors';
import { idSchema, segmentDueAtMs } from '@daisy/protocol';
import type { ProviderCall } from '../../server/provider-budget';
import type { Owed } from './duty';
import { createPhraseSource } from './phrase-source';

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
const dueAtOf = (segment: Context['round']['segments'][number]) =>
  segmentDueAtMs({
    startedAtMs: Date.parse(segment.startedAt),
    durationMs: segment.durationMs,
    returnedMs: segment.returnedMs,
  });
function messagesFor(
  context: Context,
  scope: BotPublicationScope,
  nowMs: number,
  to: Owed,
) {
  const { round, seat, profile } = context;
  const segment = round.segments.find((row) => row.id === scope.segmentId);
  const rule = round.rules.segments.find(
    (row) => row.key === segment?.rulesSegmentKey,
  );
  if (
    !segment ||
    !rule ||
    seat.role === 'judge' ||
    !Number.isFinite(nowMs) ||
    round.resolution === null
  )
    throw createAppError('CONFLICT');
  const durationMs = dueAtOf(segment) - nowMs;
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
      side: rule.side,
      durationMs,
    },
    unanswered: to.kind === 'unanswered',
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
              interrupted: line.interrupted,
            },
          ]
        : [];
    }),
  });
}
type Usage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly characters: number;
};
/** How long after each refused usage record it is asked again, by itself. */
const SETTLE_AGAIN_AFTER_MS = [200, 400, 800, 1600, 3200];
const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, characters: 0 };
/** Only memory phrases/PCM leave this operation; capture owns durable transcript evidence. */
export function createBotGeneration(input: {
  readonly store: Store;
  readonly voice: () => Pick<OpenRouter, 'completeStreamed' | 'speakPcm'>;
  readonly withProvider: ProviderCall;
  readonly nowMs: () => number;
  /** Resolves after `ms`: the wait between two tries at recording usage. */
  readonly pause: (ms: number) => Promise<void>;
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
  /**
   * Opens one language answer and streams it into a phrase source. The
   * provider slot is held until the stream ends. Usage is recorded once, when
   * it ends: received with the tokens the vendor reported, or failed or
   * unknown as for any call, with what was already produced left standing.
   */
  const generate = async (
    scope: BotPublicationScope,
    token: string,
    signal: AbortSignal,
    to: Owed,
  ) => {
    const producer = createPhraseSource();
    const stream = createPhraseStream();
    // The answer outlives the turn that opened it (a deferred turn resumes
    // it), so it has its own stop for when it is dropped instead.
    const abandoned = new AbortController();
    const turn = signal;
    signal = AbortSignal.any([turn, abandoned.signal]);
    /** Settles once the answer was dispatched and its first text could arrive. */
    const opened = Promise.withResolvers<void>();
    let record: (() => Promise<void>) | null = null;
    let recorded: Promise<void> | null = null;
    /** Records the usage once; a refused record is asked again, alone. */
    const close = async () => {
      await ended;
      if (!record) return;
      recorded ??= record().catch((error: unknown) => {
        recorded = null;
        throw error;
      });
      await recorded;
    };
    const ended = input
      .withProvider(signal, async () => {
        requireActive(signal);
        const voice = input.voice();
        const context = await input.store.beginRoundBotGeneration(
          scope,
          token,
          { kind: 'language' },
        );
        const finish = (
          outcome: 'received' | 'failed' | 'unknown',
          usage: Usage,
        ) =>
          input.store.finishRoundBotGeneration(
            scope,
            context.execution,
            outcome,
            usage,
          );
        let sent = false;
        try {
          requireActive(signal);
          const request = {
            model: context.model,
            messages: messagesFor(context, scope, input.nowMs(), to),
            maxTokens: input.maxTokens,
            temperature: 0.6,
            // Thinking comes before the first word: a speaker must start.
            reasoning: 'none' as const,
            signal,
          };
          requireActive(signal);
          sent = true;
          const answer = await voice.completeStreamed(request, (text) =>
            producer.push(stream.push(text)),
          );
          producer.push(stream.end());
          record = () =>
            finish('received', {
              inputTokens: answer.promptTokens,
              outputTokens: answer.completionTokens,
              characters: 0,
            });
          producer.end();
        } catch (error) {
          // Certainly unserved: settled failed with no usage. Anything else
          // may have been served.
          const outcome =
            !sent || isDefiniteProviderFailure(error) ? 'failed' : 'unknown';
          record = () => finish(outcome, NO_USAGE);
          // The whole sentences already written are still said.
          producer.push(stream.cut());
          producer.cut(error);
        }
      })
      // Refused before dispatch (a full budget, a cancelled call): nothing was bought.
      .catch((error: unknown) => producer.cut(error))
      .finally(() => opened.resolve());
    // Recorded as soon as the stream ends, while the speech still plays, and
    // asked again by itself while it is refused: a turn that is cut never
    // reaches its own `close`, and a paid call must not stay unsettled.
    void ended.then(async () => {
      for (const pauseMs of [...SETTLE_AGAIN_AFTER_MS, null]) {
        if (
          await close().then(
            () => true,
            () => false,
          )
        )
          return;
        if (pauseMs !== null) await input.pause(pauseMs);
      }
    });
    void producer.source.at(0).then(() => opened.resolve());
    await opened.promise;
    const cut = producer.source.cutBy();
    // An answer that failed before its first phrase is a failed call, as ever.
    if (cut && producer.source.ready(0) === undefined) {
      await close();
      throw cut.error;
    }
    let verified = false;
    return {
      value: { phrases: producer.source },
      /**
       * Re-verifies authority before the first phrase. An answer that ended
       * with nothing to say is still paid for: its usage settles before it
       * fails the attempt.
       */
      settle: async () => {
        if (producer.source.ended() && producer.source.ready(0) === undefined) {
          await close();
          throw createAppError('INFRASTRUCTURE', 'Empty bot phrase');
        }
        if (verified) return;
        requireActive(signal);
        await input.store.verifyRoundBotPublication(scope, token);
        verified = true;
      },
      close,
      abandon: () => abandoned.abort(),
    };
  };
  return {
    generate,
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
          }),
          call: async (voice, { request }) => {
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
