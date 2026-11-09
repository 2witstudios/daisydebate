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
/** A later phrase, voiced while the current one plays (ADR 0122). */
type Upcoming = {
  readonly index: number;
  /** Settles once the answer is bought and its usage recorded. */
  done: Promise<void>;
  answer: Answer<BotSpeechJob> | null;
  settled: boolean;
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
  /**
   * The spoken phrase's line id. A retry keeps it, so a phrase start that
   * committed but whose answer was lost is not written twice; it changes
   * only once the line was closed, so a cut phrase said again is a new line.
   */
  lineId: string | null;
  /**
   * The phrase played last, until its line is settled: only then has it been
   * spoken. A line never written puts the speech back on that phrase.
   */
  confirming: {
    readonly answer: Answer<BotSpeechJob>;
    readonly lineId: string;
    readonly line: Promise<void>;
  } | null;
};
const freshProgress = (): Progress => ({
  generated: null,
  settled: false,
  spoken: 0,
  synthesized: null,
  ready: false,
  ahead: [],
  lineId: null,
  confirming: null,
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
      done: Promise.resolve(),
    };
    upcoming.done = (async () => {
      upcoming.answer = await input.synthesize(
        scope,
        token,
        input.nextId(),
        phrases[index]!,
        signal,
      );
      await upcoming.answer.settle();
      upcoming.settled = true;
    })();
    // Read when its turn comes; a failure there is that phrase's failure.
    upcoming.done.catch(() => undefined);
    return upcoming;
  };
  /** Keeps the phrases after the one now due voiced ahead, each once. */
  const voiceAhead = (phrases: readonly string[], signal: AbortSignal) => {
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
      await upcoming.done.catch(() => undefined);
      // An answer bought but not settled is kept and settled again; one never
      // bought is voiced now, in turn, rather than deferring the whole turn.
      if (upcoming.answer)
        return { answer: upcoming.answer, ready: upcoming.settled };
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
    return { answer: await buying, ready: false };
  };
  /**
   * Waits for the last played phrase's line. Its start runs beside its audio
   * and has had that whole phrase to settle, so this rarely waits. A line
   * never written puts the speech back on that phrase, under the same line
   * id, so it is said again and written before the speech counts it spoken.
   */
  const confirm = async () => {
    const played = progress.confirming;
    if (!played) return;
    try {
      await played.line;
      progress.confirming = null;
    } catch (error) {
      progress.confirming = null;
      progress.spoken -= 1;
      progress.synthesized = played.answer;
      progress.ready = true;
      progress.lineId = played.lineId;
      throw error;
    }
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
      voiceAhead(phrases, signal);
      stage = 'publish';
      await confirm();
      const outcome = await speak(progress.synthesized.value, signal, stopAtMs);
      // The segment is over: the speech ends at its last whole phrase.
      if (outcome.segmentEnded) return;
      if (!outcome.complete) throw createAppError('CONFLICT', STOPPED);
      progress.confirming = {
        answer: progress.synthesized,
        lineId: progress.lineId!,
        line: outcome.line,
      };
      progress.spoken += 1;
      progress.synthesized = null;
      progress.ready = false;
      progress.lineId = null;
    }
    // The last phrase is spoken only once its line is written too.
    stage = 'publish';
    await confirm();
  };
  /** A failed attempt keeps a usable answer for the next one. */
  const spendAttempt = (error: unknown) => {
    // An answer with nothing to say is unusable: the next attempt buys another.
    if (progress.generated?.value.phrases.length === 0)
      progress = freshProgress();
    attempts += 1;
    if (crossEx) owed = attempts < input.maxAttempts;
    input.failed(error, stage);
  };
  /** Settles one failed turn by the rule above; never rethrows. */
  const recover = (error: unknown, aborted: boolean) => {
    if (aborted) return void (progress = freshProgress());
    // A spent voice budget or an answered segment cannot clear: stop.
    if (isFinalBotSpeechRefusal(error)) return void (finished = true);
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
        progress = freshProgress();
      }
      return;
    }
    spendAttempt(error);
  };
  const turn = async (abort: AbortController) => {
    try {
      await deliver(abort.signal);
      progress = freshProgress();
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
        progress = freshProgress();
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
      if (kind === 'speech-start' && !playing && !running) return;
      cancel();
    },
    playing: () => playing,
    async stop() {
      stopped = true;
      const current = running;
      cancel();
      await current?.done;
    },
  };
}
