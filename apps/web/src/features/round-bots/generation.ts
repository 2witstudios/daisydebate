import {
  createPhraseStream,
  isDefiniteProviderFailure,
  type OpenRouter,
} from '@daisy/ai-voice';
import type {
  createBotPublicationOperations,
  BotPublicationScope,
} from '@daisy/db/bot-publication';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { OneShotTimer } from '../../lib/worker-timers';
import type { ProviderCall } from '../../server/provider-budget';
import type { Owed } from './duty';
import { debaterPrompt } from './debater-prompt';
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
  /** Stops a language stream that has gone quiet. */
  readonly timer: OneShotTimer;
  /** How long a language stream may go without a word before it is stopped. */
  readonly stallMs: number;
  readonly maxTokens: number;
}) {
  if (
    !Number.isSafeInteger(input.maxTokens) ||
    input.maxTokens < 1 ||
    input.maxTokens > 16000
  )
    throw createAppError('VALIDATION');
  /**
   * One admitted provider call: the claim's authority and a durable request
   * intent first, then the vendor, inside the provider budget. It never
   * throws for the call itself: the outcome says whether the vendor certainly
   * did not serve it (`failed`) or may have (`unknown`), and `finish` records
   * whichever usage is then known.
   */
  const send = <P, R>(
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
      ) => Promise<R>;
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
        const providerInput = step.buildProviderInput(context);
        requireActive(signal);
        sent = true;
        const value = await step.call(voice, providerInput);
        return { finish, answer: { ok: true as const, value } };
      } catch (error) {
        // Certainly unserved only when never sent, or refused by the vendor.
        const outcome =
          !sent || isDefiniteProviderFailure(error)
            ? ('failed' as const)
            : ('unknown' as const);
        return { finish, answer: { ok: false as const, error, outcome } };
      }
    });
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
    send(scope, token, request, signal, step).then(({ finish, answer }) => {
      if (!answer.ok)
        // Settled failed with no usage, which gives the voice characters
        // back; an uncertain call keeps the characters it reserved.
        return finish(answer.outcome, {
          ...NO_USAGE,
          characters:
            answer.outcome === 'unknown' && request.kind === 'tts'
              ? request.characters
              : 0,
        }).then(() => {
          throw answer.error;
        });
      const result = answer.value;
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
    // A stream is as long as its answer, so no bound on its whole length is
    // right: it is stopped when nothing has arrived for `stallMs`.
    const stalled = new AbortController();
    let watch: unknown = null;
    const stillWriting = () => {
      input.timer.clearTimeout(watch);
      watch = input.timer.setTimeout(() => stalled.abort(), input.stallMs);
    };
    const turn = signal;
    signal = AbortSignal.any([turn, abandoned.signal, stalled.signal]);
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
    const ended = send(scope, token, { kind: 'language' }, signal, {
      buildProviderInput: (context) => ({
        model: context.model,
        messages: debaterPrompt(context, scope, input.nowMs(), to),
        maxTokens: input.maxTokens,
        temperature: 0.6,
        // Thinking comes before the first word: a speaker must start.
        reasoning: 'none' as const,
        signal,
      }),
      call: (voice, request) => {
        stillWriting();
        return voice.completeStreamed(request, (text) => {
          stillWriting();
          producer.push(stream.push(text));
        });
      },
    })
      .then(({ finish, answer }) => {
        if (answer.ok) {
          const { promptTokens, completionTokens } = answer.value;
          producer.push(stream.end());
          record = () =>
            finish('received', {
              inputTokens: promptTokens,
              outputTokens: completionTokens,
              characters: 0,
            });
          return producer.end();
        }
        record = () => finish(answer.outcome, NO_USAGE);
        // The whole sentences already written are still said.
        producer.push(stream.cut());
        producer.cut(
          // A stall is the provider failing, not the claim's authority
          // changing: it reads as cancelled only because the watch stopped it.
          stalled.signal.aborted
            ? createAppError('INFRASTRUCTURE', 'Bot answer stalled')
            : answer.error,
        );
      })
      // Refused before dispatch (a full budget, a cancelled call): nothing was bought.
      .catch((error: unknown) => producer.cut(error))
      .finally(() => {
        input.timer.clearTimeout(watch);
        opened.resolve();
      });
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
