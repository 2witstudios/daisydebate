import { instantMs } from '@daisy/clock';
import type { createAudioPublication } from '@daisy/media/audio';
import { createStreamingAudioWriter } from '@daisy/media/publication';
import type { Database } from '@daisy/db';
import type { BotPublicationScope } from '@daisy/db/bot-publication';
import { createAppError, isAppError } from '@daisy/errors';
import { lineClosed, lineTailCut } from './model/line-ledger';
import {
  emptyPublisher,
  stepPublisher,
  STOPPED,
  type CallArgs,
  type Failure,
  type PhraseOutcome,
  type PublisherEffect,
  type PublisherEvent,
  type Wait,
} from './model/publisher';
export type { PhraseOutcome } from './model/publisher';
export { playedFraction } from './model/line-ledger';

type Publication = Awaited<ReturnType<typeof createAudioPublication>>;
/** One synthesized bot phrase, bound to its publication scope and token. */
export type BotSpeechJob = {
  readonly scope: BotPublicationScope;
  readonly token: string;
  readonly phraseId: string;
  readonly text: string;
  readonly pcm: Int16Array;
  readonly sampleRate: 24000;
  readonly channels: 1;
};
type Store = Pick<
  Database,
  | 'verifyRoundBotPublication'
  | 'beginRoundBotPhrase'
  | 'endRoundBotPhrase'
  | 'revealRoundBotPhrase'
  | 'watchRoundBotFloor'
>;
type Claim = { readonly scope: BotPublicationScope; readonly token: string };
const FRAME_SAMPLES = 240;
const SAMPLE_RATE = 24000;
/** How far ahead of playout frames are handed to the native queue. */
const LEAD_MS = 300;
/** The native queue: comfortably above the lead, so a handoff never waits. */
const QUEUE_MS = 500;
/** TTS audio in whole 10 ms frames, the last padded with silence (ISSUE-454). */
function wholeFrames(pcm: Int16Array) {
  const tail = pcm.length % FRAME_SAMPLES;
  if (tail === 0) return pcm;
  const padded = new Int16Array(pcm.length + FRAME_SAMPLES - tail);
  padded.set(pcm);
  return padded;
}
/** A refusal is an answer; anything else (a lost reply, a timeout) is worth asking again. */
const failureOf = (error: unknown): Failure => ({
  error,
  transient:
    !isAppError(error) ||
    !['CONFLICT', 'AUTHORIZATION', 'VALIDATION', 'NOT_FOUND'].includes(
      error.code,
    ),
  roomChanged: isAppError(error) && error.reason === 'bot-room-changed',
});
const isoOf = (ms: number | null) =>
  ms === null ? undefined : new Date(ms).toISOString();
const keyOf = (wait: Wait) => JSON.stringify(wait);

/** One store call, as the publisher's step asked for it. */
function storeCall(store: Store, claim: Claim, args: CallArgs) {
  const { scope, token } = claim;
  switch (args.kind) {
    case 'authorize': {
      const startsAt = isoOf(args.startsAtMs);
      return store.beginRoundBotPhrase(
        scope,
        token,
        {
          phraseId: args.phrase.id,
          text: args.phrase.text,
          durationMs: args.phrase.durationMs,
          startsInMs: args.startsInMs,
          ...(startsAt === undefined ? {} : { startsAt }),
        },
        args.room,
      );
    }
    case 'reveal':
      return store.revealRoundBotPhrase(
        scope,
        token,
        {
          phraseId: args.phrase.id,
          text: args.phrase.text,
          durationMs: args.phrase.durationMs,
        },
        args.room,
        isoOf(args.startedAtMs),
      );
    case 'end':
      return store.endRoundBotPhrase(scope, token, args.phraseId, args.end);
  }
}

/**
 * A claim's publisher (ADR 0122): the interpreter of `stepPublisher`. It
 * holds the audio track, the phrase's audio and the pending waits, performs
 * each effect the step returns and reports its result as the next event.
 */
export function createBotPublisher(input: {
  readonly store: Store;
  readonly botToken: (
    scope: BotPublicationScope,
    token: string,
  ) => Promise<{ url: string; token: string; roomName: string }>;
  readonly connect: typeof createAudioPublication;
  readonly nextId: () => string;
  readonly monotonicNowMs: () => number;
  readonly waitUntilMs: (due: number, signal: AbortSignal) => Promise<void>;
}) {
  return (claim: Claim) => {
    let state = emptyPublisher();
    const tracks = new Map<number, Publication>();
    const waits = new Map<string, AbortController>();
    const deadlines: ReturnType<typeof Promise.withResolvers<number>>[] = [];
    const closed = Promise.withResolvers<void>();
    let phrase: {
      readonly pcm: Int16Array;
      readonly answer: ReturnType<typeof Promise.withResolvers<PhraseOutcome>>;
    } | null = null;
    let writing: AbortController | null = null;
    const native = () =>
      'join' in state.track ? tracks.get(state.track.join) : undefined;
    const dispatch = (event: DistributiveOmit<PublisherEvent, 'facts'>) => {
      const track = native();
      const next = stepPublisher(state, {
        ...event,
        facts: {
          nowMs: input.monotonicNowMs(),
          queuedMs: track?.queuedMs() ?? 0,
          usable: track?.usable() ?? false,
        },
      });
      state = next.state;
      for (const effect of next.effects) perform(effect);
    };
    const join = async (id: number) => {
      await input.store.verifyRoundBotPublication(claim.scope, claim.token);
      const grant = await input.botToken(claim.scope, claim.token);
      const track = await input.connect({
        url: grant.url,
        token: grant.token,
        trackName: input.nextId(),
        sampleRate: SAMPLE_RATE,
        channels: 1,
        queueMs: QUEUE_MS,
      });
      tracks.set(id, track);
      dispatch({
        type: 'joined',
        join: id,
        room: grant.roomName,
        usable: track.usable(),
      });
    };
    const write = (stopAtMs: number) => {
      const target = native();
      if (!phrase || !target) return;
      writing = new AbortController();
      void createStreamingAudioWriter({
        target,
        sampleRate: SAMPLE_RATE,
        channels: 1,
        nowMs: input.monotonicNowMs,
        waitUntilMs: input.waitUntilMs,
        leadMs: LEAD_MS,
      })(wholeFrames(phrase.pcm), writing.signal, stopAtMs).then((written) =>
        dispatch({ type: 'written', written }),
      );
    };
    const wait = (target: Wait, untilMs: number) => {
      const cancel = new AbortController();
      waits.set(keyOf(target), cancel);
      void input.waitUntilMs(untilMs, cancel.signal).then(() => {
        if (cancel.signal.aborted) return;
        waits.delete(keyOf(target));
        dispatch({ type: 'woke', wait: target });
      });
    };
    function perform(effect: PublisherEffect) {
      switch (effect.type) {
        case 'join':
          return void join(effect.join).catch(() =>
            dispatch({ type: 'join-failed', join: effect.join }),
          );
        case 'leave': {
          const track = tracks.get(effect.join);
          tracks.delete(effect.join);
          return void track
            ?.close()
            .then(() => dispatch({ type: 'left', join: effect.join }));
        }
        case 'call':
          return void storeCall(input.store, claim, effect.args).then(
            () => dispatch({ type: 'answered', call: effect.call }),
            (error: unknown) =>
              dispatch({
                type: 'refused',
                call: effect.call,
                failure: failureOf(error),
              }),
          );
        case 'watch-floor':
          return void input.store
            .watchRoundBotFloor(claim.scope, claim.token, effect.room)
            .then(
              () =>
                dispatch({
                  type: 'floor-read',
                  phraseId: effect.phraseId,
                  failure: null,
                }),
              (error: unknown) =>
                dispatch({
                  type: 'floor-read',
                  phraseId: effect.phraseId,
                  failure: failureOf(error),
                }),
            );
        case 'write':
          return write(effect.stopAtMs);
        case 'stop-writing':
          return writing?.abort();
        case 'clear-queue':
          return native()?.clearQueue();
        case 'wait':
          return wait(effect.wait, effect.untilMs);
        case 'cancel':
          waits.get(keyOf(effect.wait))?.abort();
          return void waits.delete(keyOf(effect.wait));
        case 'deadline':
          return deadlines.shift()?.resolve(effect.atMs);
        case 'answer': {
          const answer = phrase?.answer;
          phrase = null;
          writing = null;
          if (effect.kind === 'outcome') return answer?.resolve(effect.outcome);
          return answer?.reject(
            effect.error === STOPPED
              ? createAppError('CONFLICT')
              : effect.error,
          );
        }
        case 'closed':
          return closed.resolve();
        case 'resume':
          return void Promise.resolve().then(() =>
            dispatch({ type: 'resumed' }),
          );
      }
    }
    const phraseOf = (job: BotSpeechJob) => ({
      id: job.phraseId,
      text: job.text,
      durationMs: wholeFrames(job.pcm).length / (SAMPLE_RATE / 1000),
      samples: job.pcm.length,
    });
    return {
      /** Joins the Room ahead of speech. */
      start: () => dispatch({ type: 'start' }),
      /** The monotonic instant the claim's segment is due, read once per speech. */
      deadline: async () => {
        const sentAtMs = input.monotonicNowMs();
        const read = await input.store.verifyRoundBotPublication(
          claim.scope,
          claim.token,
        );
        const due = Promise.withResolvers<number>();
        deadlines.push(due);
        dispatch({
          type: 'clock-read',
          sentAtMs,
          serverNowMs: instantMs(read.now),
          segmentDueAtMs: instantMs(read.segmentDueAt),
        });
        return due.promise;
      },
      writeAhead: (job: BotSpeechJob) =>
        dispatch({ type: 'write-ahead', phrase: phraseOf(job) }),
      /** Forgets every phrase authorized ahead: the speech will not say them. */
      discard: () => dispatch({ type: 'discard' }),
      /** Plays one phrase and authors its line; never plays past `stopAtMs`. */
      publish: async (
        job: BotSpeechJob,
        signal: AbortSignal,
        stopAtMs: number,
      ): Promise<PhraseOutcome> => {
        if (
          !(job.pcm instanceof Int16Array) ||
          job.pcm.length === 0 ||
          job.pcm.length > SAMPLE_RATE * 60 ||
          !Number.isFinite(stopAtMs)
        )
          throw createAppError('VALIDATION');
        const answer = Promise.withResolvers<PhraseOutcome>();
        phrase = { pcm: job.pcm, answer };
        const stop = () => dispatch({ type: 'stop' });
        signal.addEventListener('abort', stop, { once: true });
        dispatch({
          type: 'publish',
          phrase: phraseOf(job),
          stopAtMs,
          stopped: signal.aborted,
        });
        try {
          return await answer.promise;
        } finally {
          signal.removeEventListener('abort', stop);
        }
      },
      /** Whether this claim closed the line: a retry then needs a new one. */
      lineClosed: (phraseId: string) => lineClosed(state.lines, phraseId),
      /** Whether a phrase reported played whole had its queued tail cut since. */
      tailCut: (phraseId: string) => lineTailCut(state.lines, phraseId),
      /** Whether audio handed over is still playing out of the queue. */
      audible: () => (native()?.queuedMs() ?? 0) > 0,
      /** Drops whatever is still queued: a barge-in on a tail is silent at once. */
      silence: () => dispatch({ type: 'silence' }),
      /** Ends the claim: silences it, closes every played line, then leaves the track. */
      close: () => {
        dispatch({ type: 'close' });
        return closed.promise;
      },
    };
  };
}
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;
