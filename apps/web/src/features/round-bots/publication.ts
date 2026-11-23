import { instantMs } from '@daisy/clock';
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
  type PublisherEventBody,
  type Wait,
} from './model/publisher';
import {
  joinTrack,
  phraseOf,
  playable,
  storeCall,
  streamPhrase,
  type BotSpeechJob,
  type Input,
  type Publication,
} from './publication-io';
export type { BotSpeechJob } from './publication-io';

type Claim = { readonly scope: BotPublicationScope; readonly token: string };
type Event = PublisherEventBody;
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

function join(shell: Shell, id: number) {
  const { input, claim } = shell;
  const { scope, token } = claim;
  void joinTrack({
    verify: () => input.store.verifyRoundBotPublication(scope, token),
    grant: () => input.botToken(scope, token),
    connect: input.connect,
    trackName: input.nextId,
  }).then(
    ({ track, room }) => {
      shell.tracks.set(id, track);
      const usable = track.usable();
      dispatch(shell, { type: 'joined', join: id, room, usable });
    },
    () => dispatch(shell, { type: 'join-failed', join: id }),
  );
}

function write(shell: Shell, stopAtMs: number) {
  const target = native(shell);
  if (!shell.phrase || !target) return;
  const writing = new AbortController();
  shell.writing = writing;
  const { pcm } = shell.phrase;
  void streamPhrase(shell.input, target, pcm, writing.signal, stopAtMs).then(
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
      return join(shell, effect.join);
    case 'leave': {
      const track = shell.tracks.get(effect.join);
      shell.tracks.delete(effect.join);
      const left: Event = { type: 'left', join: effect.join };
      return void track?.close().then(() => dispatch(shell, left));
    }
    case 'call': {
      const { call } = effect;
      return void storeCall(shell.input.store, shell.claim, effect.args).then(
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
    case 'answer': {
      const pending = shell.phrase?.answer;
      shell.phrase = null;
      shell.writing = null;
      if (effect.kind === 'outcome') return pending?.resolve(effect.outcome);
      const stopped = effect.error === STOPPED;
      return pending?.reject(
        stopped ? createAppError('CONFLICT') : effect.error,
      );
    }
    case 'closed':
      return shell.closed.resolve();
  }
}

/** Plays one phrase and authors its line beside it; never plays past `stopAtMs`. */
async function publish(
  shell: Shell,
  job: BotSpeechJob,
  signal: AbortSignal,
  stopAtMs: number,
) {
  const { pcm } = playable(job, stopAtMs);
  const answer = Promise.withResolvers<PhraseOutcome>();
  shell.phrase = { pcm, answer };
  const stop = () => dispatch(shell, { type: 'stop' });
  signal.addEventListener('abort', stop, { once: true });
  const phrase = phraseOf(job);
  const stopped = signal.aborted;
  dispatch(shell, { type: 'publish', phrase, stopAtMs, stopped });
  try {
    return await answer.promise;
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

/** One claim's publisher. */
export type BotPublisher = ReturnType<ReturnType<typeof createBotPublisher>>;
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
