import type { BotPublicationScope } from '@daisy/db/bot-publication';
import { isCapacityRefusal } from '@daisy/db/capacity';
import { isFinalBotSpeechRefusal } from '@daisy/db/bot-publication';
import { createAppError, isAppError } from '@daisy/errors';
import type { BotSpeechJob, PhraseOutcome } from './publication';

/** A provider answer held in memory until its usage and authority settle. */
type Answer<T> = {
  readonly value: T;
  /** Idempotent: safe to call again after a refusal. */
  readonly settle: () => Promise<void>;
};
/**
 * How many phrases are voiced ahead of the one playing. One is not enough:
 * a long phrase can take longer to voice than a short one before it plays.
 */
const VOICED_AHEAD = 2;
/**
 * An opening shorter than this waits for the phrases after it to be voiced
 * before it plays: voicing a long phrase can outlast short ones, and a speech
 * that stalls after its first words sounds broken. A late start does not.
 */
const SHORT_OPENING_MS = 4000;
/** A later phrase, voiced while the current one plays (ADR 0122). */
type Upcoming = {
  readonly index: number;
  /** Settles once the answer is bought and its usage recorded. */
  done: Promise<void>;
  answer: Answer<BotSpeechJob> | null;
  settled: boolean;
  /** It bought nothing (a refused pool slot, a provider error): voice it again. */
  failed: boolean;
  /** The line id it will be spoken under; a new one once that line closed. */
  lineId: string;
};
/** How far one turn got; kept across deferrals so no step is bought twice. */
type Progress = {
  generated: Answer<{ readonly phrases: readonly string[] }> | null;
  settled: boolean;
  spoken: number;
  /** The phrase being spoken, and whether its usage and authority settled. */
  synthesized: Answer<BotSpeechJob> | null;
  ready: boolean;
  /** The phrases voiced ahead, each bought once and kept across retries. */
  ahead: Upcoming[];
  /** Ends the voicing ahead once the speech is over: nothing more is bought. */
  voicing: AbortController;
  /**
   * The spoken phrase's line id. A retry keeps it, so a phrase start that
   * committed but whose answer was lost is not written twice; it changes
   * only once the line was closed, so a cut phrase said again is a new line.
   */
  lineId: string | null;
};
const freshProgress = (): Progress => ({
  generated: null,
  settled: false,
  spoken: 0,
  synthesized: null,
  ready: false,
  ahead: [],
  voicing: new AbortController(),
  lineId: null,
});
const STOPPED = 'Bot publication stopped before the phrase was sent';
const isPlatformIncidentRefusal = (error: unknown) =>
  isAppError(error) && error.reason === 'platform-incident';
export type PeerActivity =
  'speech-start' | 'end-of-turn' | 'barge-in' | 'unknown';
/**
 * One speaking turn at a time per owned claim. Each phrase is authored into
 * the transcript as it plays (ADR 0122), and the next phrase is voiced while
 * the current one plays, so there is no gap between them. A speech buys one
 * provider answer and keeps it through every failure until it is delivered,
 * so a retry resumes at the failed phrase and no answer is bought twice; a
 * phrase cut by a failure is said again whole, as a new line. Refused authority and
 * refused pool admission wait without spending an attempt; a final refusal
 * ends the speech. The speaker never issues floor commands or touches control
 * receipts.
 */
export function createBotSpeaker(input: {
  readonly claim: {
    readonly scope: BotPublicationScope;
    readonly token: string;
    readonly segmentType: 'speech' | 'cross_ex';
    /** The scheduled seat asks first; every other cross-examination seat waits. */
    readonly opensExchange: boolean;
  };
  readonly generate: (
    scope: BotPublicationScope,
    token: string,
    signal: AbortSignal,
  ) => Promise<
    Answer<{ readonly text: string; readonly phrases: readonly string[] }>
  >;
  readonly synthesize: (
    scope: BotPublicationScope,
    token: string,
    phraseId: string,
    text: string,
    signal: AbortSignal,
  ) => Promise<Answer<BotSpeechJob>>;
  /** The monotonic instant the claim's segment is due, read once per speech. */
  readonly deadline: () => Promise<number>;
  /** Whether the publisher closed this line, so a retry needs a new one. */
  readonly lineClosed: (phraseId: string) => boolean;
  /** Whether audio already handed over is still playing out of the queue. */
  readonly audible: () => boolean;
  /** Drops whatever is still queued, at once. */
  readonly silence: () => void;
  /** Authorizes a phrase while the one before it plays (ADR 0122). */
  readonly writeAhead: (job: BotSpeechJob) => void;
  /** Forgets phrases authorized ahead that will not be said. */
  readonly discard: () => void;
  /** Plays one phrase and authors its line; never plays past `stopAtMs`. */
  readonly publish: (
    job: BotSpeechJob,
    signal: AbortSignal,
    stopAtMs: number,
  ) => Promise<PhraseOutcome>;
  readonly nextId: () => string;
  readonly maxAttempts: number;
  /** `stage` names the work that failed: generate, synthesize or publish. */
  readonly failed: (error: unknown, stage: string) => void;
}) {
  const { scope, token, segmentType, opensExchange } = input.claim;
  const crossEx = segmentType === 'cross_ex';
  let running: { abort: AbortController; done: Promise<void> } | null = null,
    playing = false,
    stopped = false,
    /** The speech is over: delivered, or refused for good. */
    finished = false,
    attempts = 0,
    /** The asker opens once; every seat then answers each ended peer turn once. */
    owed = !crossEx || opensExchange,
    /** A new peer turn makes a held cross-examination answer stale. */
    stale = false;
  let stage = 'generate';
  let progress = freshProgress();
  /** Plays one phrase under its line id, a new one once its line closed. */
  const speak = async (
    phrase: BotSpeechJob,
    signal: AbortSignal,
    stopAtMs: number,
  ) => {
    if (progress.lineId === null || input.lineClosed(progress.lineId))
      progress.lineId = input.nextId();
    playing = true;
    try {
      return await input.publish(
        { ...phrase, phraseId: progress.lineId },
        signal,
        stopAtMs,
      );
    } finally {
      playing = false;
    }
  };
  /** Voices phrase `index` ahead of its turn, holding the answer once bought. */
  const prefetch = (
    phrases: readonly string[],
    index: number,
    signal: AbortSignal,
  ): Upcoming => {
    const upcoming: Upcoming = {
      index,
      answer: null,
      settled: false,
      failed: false,
      lineId: input.nextId(),
      done: Promise.resolve(),
    };
    const voicing = progress.voicing.signal;
    upcoming.done = (async () => {
      try {
        upcoming.answer = await input.synthesize(
          scope,
          token,
          input.nextId(),
          phrases[index]!,
          AbortSignal.any([signal, voicing]),
        );
      } catch (error) {
        upcoming.failed = true;
        throw error;
      }
      // A voice was bought, so a pool slot is free: one refused is asked again.
      if (!signal.aborted && !voicing.aborted) voiceAhead(phrases, signal);
      await upcoming.answer.settle();
      upcoming.settled = true;
      // Voiced while the phrase before it plays: its line is written now.
      if (
        progress.ahead.includes(upcoming) &&
        upcoming.index === progress.spoken + 1
      )
        prepareAhead(upcoming);
    })();
    // Read when its turn comes; one that bought nothing is voiced again.
    upcoming.done.catch(() => undefined);
    return upcoming;
  };
  /** Authorizes a voiced-ahead phrase while the phrase before it plays. */
  const prepareAhead = (upcoming: Upcoming) => {
    if (!playing || !upcoming.answer || !upcoming.settled) return;
    // A line closed is never written again under its id.
    if (input.lineClosed(upcoming.lineId)) upcoming.lineId = input.nextId();
    input.writeAhead({ ...upcoming.answer.value, phraseId: upcoming.lineId });
  };
  /**
   * Waits, for a short opening, until the phrases voiced so far would play for
   * SHORT_OPENING_MS, or every phrase voiced ahead is in: two short opening
   * phrases must not stall on a long third.
   */
  const holdShortOpening = async (signal: AbortSignal) => {
    const job = progress.synthesized?.value;
    if (!job) return;
    const lengthOf = (voiced: BotSpeechJob) =>
      (voiced.pcm.length / voiced.sampleRate) * 1000;
    let heldMs = lengthOf(job);
    const stopped = Promise.withResolvers<void>();
    const stop = () => stopped.resolve();
    signal.addEventListener('abort', stop, { once: true });
    try {
      for (
        let index = 1;
        heldMs < SHORT_OPENING_MS && index <= VOICED_AHEAD;
        index += 1
      ) {
        const next = progress.ahead.find((held) => held.index === index);
        if (!next || signal.aborted) return;
        await Promise.race([next.done.catch(() => undefined), stopped.promise]);
        // A voice refused or failed ends the hold: the speech goes on.
        const voiced = next.answer?.value;
        if (signal.aborted || !voiced) return;
        heldMs += lengthOf(voiced);
      }
    } finally {
      signal.removeEventListener('abort', stop);
    }
  };
  /** Keeps the phrases after the one now due voiced ahead, each once. */
  const voiceAhead = (phrases: readonly string[], signal: AbortSignal) => {
    // A voice-ahead that bought nothing is asked again now, a phrase early,
    // never left to be bought only when its own turn comes.
    progress.ahead = progress.ahead.filter((held) => !held.failed);
    const last = Math.min(phrases.length - 1, progress.spoken + VOICED_AHEAD);
    for (let index = progress.spoken + 1; index <= last; index += 1)
      if (!progress.ahead.some((held) => held.index === index))
        progress.ahead.push(prefetch(phrases, index, signal));
  };
  /** The phrase now due: the voiced-ahead one, or bought now. */
  const take = async (phrases: readonly string[], signal: AbortSignal) => {
    const upcoming = progress.ahead.find(
      (held) => held.index === progress.spoken,
    );
    if (upcoming) {
      progress.ahead = progress.ahead.filter((held) => held !== upcoming);
      // Later phrases keep being voiced while this one is readied.
      voiceAhead(phrases, signal);
      await upcoming.done.catch(() => undefined);
      // An answer bought but not settled is kept and settled again; one never
      // bought is voiced now, in turn, rather than deferring the whole turn.
      if (upcoming.answer) {
        progress.lineId ??= upcoming.lineId;
        return { answer: upcoming.answer, ready: upcoming.settled };
      }
    }
    const buying = input.synthesize(
      scope,
      token,
      input.nextId(),
      phrases[progress.spoken]!,
      signal,
    );
    // Later phrases are voiced alongside this one, so even a short phrase
    // never leaves the next waiting for its voice.
    voiceAhead(phrases, signal);
    const answer = await buying;
    // A voice was bought, so a pool slot is free: one refused is asked again.
    voiceAhead(phrases, signal);
    return { answer, ready: false };
  };
  /** Resumes the turn at its first unfinished step. */
  const deliver = async (signal: AbortSignal) => {
    stage = 'generate';
    progress.generated ??= await input.generate(scope, token, signal);
    if (!progress.settled) {
      await progress.generated.settle();
      progress.settled = true;
    }
    const { phrases } = progress.generated.value;
    stage = 'publish';
    // Once per speech, off the audio path: no phrase plays past the cutoff.
    const stopAtMs = await input.deadline();
    while (progress.spoken < phrases.length) {
      stage = 'synthesize';
      if (!progress.synthesized) {
        const next = await take(phrases, signal);
        progress.synthesized = next.answer;
        progress.ready = next.ready;
      }
      if (!progress.ready) {
        await progress.synthesized.settle();
        progress.ready = true;
      }
      if (progress.spoken === 0) await holdShortOpening(signal);
      stage = 'publish';
      const speaking = speak(progress.synthesized.value, signal, stopAtMs);
      // The next phrase, if already voiced, has its line written as this plays.
      const next = progress.ahead.find(
        (held) => held.index === progress.spoken + 1,
      );
      if (next) prepareAhead(next);
      const outcome = await speaking;
      // The segment is over: the speech ends at its last whole phrase, once
      // what it did play (cut at the hard stop) has its line.
      if (outcome.segmentEnded) return dropAhead();
      if (!outcome.complete) throw createAppError('CONFLICT', STOPPED);
      progress.spoken += 1;
      progress.synthesized = null;
      progress.ready = false;
      progress.lineId = null;
    }
    dropAhead();
  };
  /**
   * The speech is over, or this answer is: voicing ahead stops, nothing more
   * is bought, and phrases authorized ahead are forgotten.
   */
  const dropAhead = () => {
    progress.voicing.abort();
    progress.ahead = [];
    input.discard();
  };
  /** A fresh start, with nothing left voicing ahead of the last one. */
  const resetProgress = () => {
    dropAhead();
    progress = freshProgress();
  };
  /** A failed attempt keeps a usable answer for the next one. */
  const spendAttempt = (error: unknown) => {
    // An answer with nothing to say is unusable: the next attempt buys another.
    if (progress.generated?.value.phrases.length === 0) resetProgress();
    attempts += 1;
    if (crossEx) owed = attempts < input.maxAttempts;
    // The last attempt is spent: nothing more is bought for this speech.
    if (attempts >= input.maxAttempts) dropAhead();
    input.failed(error, stage);
  };
  /** Settles one failed turn by the rule above; never rethrows. */
  const recover = (error: unknown, aborted: boolean) => {
    if (aborted) return void resetProgress();
    // A spent voice budget or an answered segment cannot clear: stop.
    if (isFinalBotSpeechRefusal(error)) {
      finished = true;
      return dropAhead();
    }
    // Pool backpressure is a deferral: the next wake resumes at the refused step.
    if (isCapacityRefusal(error)) {
      if (crossEx) owed = true;
      return input.failed(error, stage);
    }
    // A platform incident is a wait: the same answer resumes where it stopped,
    // in cross-examination too, with nothing new bought and no attempt spent.
    if (isPlatformIncidentRefusal(error)) {
      if (crossEx) owed = true;
      return;
    }
    // One paid answer per speech: every other failure keeps it, and the
    // next attempt resumes at the failed step. A cross-examination answer
    // belongs to its peer turn, so changed authority drops it.
    if (isAppError(error) && error.code === 'CONFLICT') {
      if (crossEx) {
        owed = true;
        resetProgress();
      }
      return;
    }
    spendAttempt(error);
  };
  const turn = async (abort: AbortController) => {
    try {
      await deliver(abort.signal);
      resetProgress();
      if (!crossEx) finished = true;
    } catch (error) {
      recover(error, abort.signal.aborted);
    } finally {
      running = null;
    }
  };
  const cancel = () => running?.abort.abort();
  return {
    wake() {
      if (stopped || running || finished || attempts >= input.maxAttempts)
        return;
      if (crossEx && !owed) return;
      owed = false;
      if (stale) {
        stale = false;
        resetProgress();
      }
      const abort = new AbortController();
      running = { abort, done: Promise.resolve() };
      running.done = turn(abort);
    },
    peer(kind: PeerActivity) {
      if (!crossEx) return;
      if (kind === 'end-of-turn') {
        owed = true;
        stale = true;
        return;
      }
      // A tail still queued is the bot speaking too: a peer cuts it at once.
      if (kind === 'speech-start' && !playing && !running && !input.audible())
        return;
      // A phrase being written stops itself, counting only what played; a
      // tail left after its publish returned is silenced here.
      const writing = playing;
      cancel();
      if (!writing) input.silence();
    },
    playing: () => playing || input.audible(),
    async stop() {
      stopped = true;
      const current = running;
      cancel();
      await current?.done;
      dropAhead();
    },
  };
}
