import { instantMs } from '@daisy/clock';
import type { createAudioPublication } from '@daisy/media/audio';
import { createStreamingAudioWriter } from '@daisy/media/publication';
import type { Database } from '@daisy/db';
import type { BotPublicationScope } from '@daisy/db/bot-publication';
import { createAppError } from '@daisy/errors';
import { lineClosed, lineTailCut } from './model/line-ledger';
import {
  emptyPublisher,
  localInstant,
  stepPublisher,
  STOPPED,
  type PhraseOutcome,
  type PublisherEffect,
  type PublisherEvent,
  type StoreCall,
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
type Input = {
  readonly store: Pick<
    Database,
    | 'verifyRoundBotPublication'
    | 'beginRoundBotPhrase'
    | 'endRoundBotPhrase'
    | 'revealRoundBotPhrase'
    | 'watchRoundBotFloor'
  >;
  readonly botToken: (
    scope: BotPublicationScope,
    token: string,
  ) => Promise<{ url: string; token: string; roomName: string }>;
  readonly connect: typeof createAudioPublication;
  readonly nextId: () => string;
  readonly monotonicNowMs: () => number;
  readonly waitUntilMs: (due: number, signal: AbortSignal) => Promise<void>;
};
type Claim = { readonly scope: BotPublicationScope; readonly token: string };
type Event = PublisherEvent extends infer E
  ? E extends unknown
    ? Omit<E, 'nowMs' | 'queuedMs' | 'trackUsable'>
    : never
  : never;
/**
 * The interpreter's resources: the step's state, the audio tracks, the audio
 * of the phrase in play and its answer, and the pending waits. No decision
 * reads them; `stepPublisher` makes every one.
 */
type Shell = {
  readonly input: Input;
  readonly claim: Claim;
  state: ReturnType<typeof emptyPublisher>;
  readonly tracks: Map<number, Publication>;
  readonly waits: Map<string, AbortController>;
  readonly closed: ReturnType<typeof Promise.withResolvers<void>>;
  phrase: {
    readonly pcm: Int16Array;
    readonly answer: ReturnType<typeof Promise.withResolvers<PhraseOutcome>>;
  } | null;
  writing: AbortController | null;
};
const SAMPLE_RATE = 24000;
const FRAME_SAMPLES = 240;
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
const keyOf = (wait: Wait) => JSON.stringify(wait);
const native = ({ state: { track }, tracks }: Shell) =>
  'join' in track ? tracks.get(track.join) : undefined;

/** Steps the publisher on one event, read against the track now, and performs its effects. */
function dispatch(shell: Shell, event: Event) {
  const track = native(shell);
  const next = stepPublisher(shell.state, {
    ...event,
    nowMs: shell.input.monotonicNowMs(),
    queuedMs: track?.queuedMs() ?? 0,
    trackUsable: track?.usable() ?? false,
  });
  shell.state = next.state;
  for (const effect of next.effects) perform(shell, effect);
}

function storeCall({ input: { store }, claim }: Shell, args: StoreCall) {
  const { scope, token } = claim;
  switch (args.kind) {
    case 'begin':
      return store.beginRoundBotPhrase(scope, token, args.phrase, args.room);
    case 'reveal': {
      const { phrase, room, startedAt } = args;
      return store.revealRoundBotPhrase(scope, token, phrase, room, startedAt);
    }
    case 'end':
      return store.endRoundBotPhrase(scope, token, args.phraseId, args.end);
    case 'floor':
      return store.watchRoundBotFloor(scope, token, args.room);
  }
}

/** Joins the claim's room on a fresh track (ADR 0110: a retired room is never rejoined). */
async function join(shell: Shell, id: number) {
  const { input, claim } = shell;
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
  shell.tracks.set(id, track);
  const usable = track.usable();
  dispatch(shell, { type: 'joined', join: id, room: grant.roomName, usable });
}

/** Streams the phrase's frames in real time, never one that would play past `stopAtMs`. */
function write(shell: Shell, stopAtMs: number) {
  const target = native(shell);
  if (!shell.phrase || !target) return;
  const writing = new AbortController();
  shell.writing = writing;
  const writer = createStreamingAudioWriter({
    target,
    sampleRate: SAMPLE_RATE,
    channels: 1,
    nowMs: shell.input.monotonicNowMs,
    waitUntilMs: shell.input.waitUntilMs,
    leadMs: LEAD_MS,
  });
  void writer(wholeFrames(shell.phrase.pcm), writing.signal, stopAtMs).then(
    (written) => dispatch(shell, { type: 'written', written }),
  );
}

function wait(shell: Shell, target: Wait, untilMs: number) {
  const cancel = new AbortController();
  shell.waits.set(keyOf(target), cancel);
  void shell.input.waitUntilMs(untilMs, cancel.signal).then(() => {
    if (cancel.signal.aborted) return;
    shell.waits.delete(keyOf(target));
    dispatch(shell, { type: 'woke', wait: target });
  });
}

function perform(shell: Shell, effect: PublisherEffect) {
  switch (effect.type) {
    case 'join':
      return void join(shell, effect.join).catch(() =>
        dispatch(shell, { type: 'join-failed', join: effect.join }),
      );
    case 'leave': {
      const track = shell.tracks.get(effect.join);
      shell.tracks.delete(effect.join);
      const left: Event = { type: 'left', join: effect.join };
      return void track?.close().then(() => dispatch(shell, left));
    }
    case 'call': {
      const { call } = effect;
      return void storeCall(shell, effect.args).then(
        () => dispatch(shell, { type: 'answered', call }),
        (error: unknown) => dispatch(shell, { type: 'refused', call, error }),
      );
    }
    case 'write':
      return write(shell, effect.stopAtMs);
    case 'stop-writing':
      return shell.writing?.abort();
    case 'clear-queue':
      return native(shell)?.clearQueue();
    case 'wait':
      return wait(shell, effect.wait, effect.untilMs);
    case 'cancel':
      shell.waits.get(keyOf(effect.wait))?.abort();
      return void shell.waits.delete(keyOf(effect.wait));
    case 'resume':
      return void Promise.resolve().then(() =>
        dispatch(shell, { type: 'resumed' }),
      );
    case 'answer':
      return answer(shell, effect);
    case 'closed':
      return shell.closed.resolve();
  }
}

/** Settles the publish in flight: its outcome, or why it stopped. */
function answer(
  shell: Shell,
  effect: Extract<PublisherEffect, { type: 'answer' }>,
) {
  const pending = shell.phrase?.answer;
  shell.phrase = null;
  shell.writing = null;
  if (effect.kind === 'outcome') return pending?.resolve(effect.outcome);
  const { error } = effect;
  pending?.reject(error === STOPPED ? createAppError('CONFLICT') : error);
}

const phraseOf = (job: BotSpeechJob) => ({
  id: job.phraseId,
  text: job.text,
  durationMs: wholeFrames(job.pcm).length / (SAMPLE_RATE / 1000),
  samples: job.pcm.length,
});

/** Plays one phrase and authors its line beside it; never plays past `stopAtMs`. */
async function publish(
  shell: Shell,
  job: BotSpeechJob,
  signal: AbortSignal,
  stopAtMs: number,
) {
  const { pcm } = job;
  if (
    !(pcm instanceof Int16Array) ||
    pcm.length === 0 ||
    pcm.length > SAMPLE_RATE * 60 ||
    !Number.isFinite(stopAtMs)
  )
    throw createAppError('VALIDATION');
  const answered = Promise.withResolvers<PhraseOutcome>();
  shell.phrase = { pcm, answer: answered };
  const stop = () => dispatch(shell, { type: 'stop' });
  signal.addEventListener('abort', stop, { once: true });
  const phrase = phraseOf(job);
  const stopped = signal.aborted;
  dispatch(shell, { type: 'publish', phrase, stopAtMs, stopped });
  try {
    return await answered.promise;
  } finally {
    signal.removeEventListener('abort', stop);
  }
}

/** The monotonic instant the claim's segment is due, read once per speech. */
async function deadline(shell: Shell) {
  const sentAtMs = shell.input.monotonicNowMs();
  const { scope, token } = shell.claim;
  const read = await shell.input.store.verifyRoundBotPublication(scope, token);
  const serverNowMs = instantMs(read.now);
  dispatch(shell, { type: 'clock-read', sentAtMs, serverNowMs });
  return localInstant(shell.state, instantMs(read.segmentDueAt));
}

/**
 * A claim's publisher (ADR 0122): the interpreter of `stepPublisher`. It
 * holds the audio track, the phrase's audio and the pending waits, performs
 * each effect the step returns and reports each result as the next event.
 */
export function createBotPublisher(input: Input) {
  return (claim: Claim) => {
    const shell: Shell = {
      input,
      claim,
      state: emptyPublisher(),
      tracks: new Map(),
      waits: new Map(),
      closed: Promise.withResolvers<void>(),
      phrase: null,
      writing: null,
    };
    const on = (event: Event) => () => dispatch(shell, event);
    return {
      /** Joins the Room ahead of speech. */
      start: on({ type: 'start' }),
      deadline: () => deadline(shell),
      /** Authorizes a phrase while the one before plays; nothing is written for it yet. */
      writeAhead: (job: BotSpeechJob) =>
        dispatch(shell, { type: 'write-ahead', phrase: phraseOf(job) }),
      /** Forgets every phrase authorized ahead: the speech will not say them. */
      discard: on({ type: 'discard' }),
      publish: (job: BotSpeechJob, signal: AbortSignal, stopAtMs: number) =>
        publish(shell, job, signal, stopAtMs),
      /** Whether this claim closed the line: a retry then needs a new one. */
      lineClosed: (phraseId: string) => lineClosed(shell.state.lines, phraseId),
      /** Whether a phrase reported played whole had its queued tail cut since. */
      tailCut: (phraseId: string) => lineTailCut(shell.state.lines, phraseId),
      /** Whether audio handed over is still playing out of the queue. */
      audible: () => (native(shell)?.queuedMs() ?? 0) > 0,
      /** Drops whatever is still queued: a barge-in on a tail is silent at once. */
      silence: on({ type: 'silence' }),
      /** Ends the claim: silences it, closes every played line, then leaves. */
      close: () => {
        dispatch(shell, { type: 'close' });
        return shell.closed.promise;
      },
    };
  };
}
