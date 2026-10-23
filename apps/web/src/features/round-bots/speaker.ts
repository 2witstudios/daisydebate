import type { BotPublicationScope } from '@daisy/db/bot-publication';
import { isTransactionCapacityRefusal } from '@daisy/db';
import { isFinalBotSpeechRefusal } from '@daisy/db/bot-publication';
import { createAppError, isAppError } from '@daisy/errors';
import { publicationStopError, type PublicationStop } from '@daisy/media/audio';
import type { BotSpeechJob } from './publication';

/** A provider answer held in memory until its usage and authority settle. */
type Answer<T> = {
  readonly value: T;
  /** Idempotent: safe to call again after a refusal. */
  readonly settle: () => Promise<void>;
};
/** How far one turn got; kept across deferrals so no step is bought twice. */
type Progress = {
  generated: Answer<{ readonly phrases: readonly string[] }> | null;
  settled: boolean;
  spoken: number;
  synthesized: Answer<BotSpeechJob> | null;
  /** Samples of the held phrase already sent, so a refused publication resumes there. */
  sent: number;
};
const freshProgress = (): Progress => ({
  generated: null,
  settled: false,
  spoken: 0,
  synthesized: null,
  sent: 0,
});
const STOPPED = 'Bot publication stopped before the phrase was sent';
export type PeerActivity =
  'speech-start' | 'end-of-turn' | 'barge-in' | 'unknown';
/**
 * One speaking turn at a time per owned claim. Phrases stay in memory; capture
 * alone credits transcript. A speech buys one provider answer and keeps it
 * through every failure until it is delivered, so a retry resumes at the failed
 * step and no answer is bought or phrase spoken twice. Refused authority and
 * refused pool admission wait without spending an attempt; a final refusal
 * ends the speech. The speaker never issues floor commands or touches control
 * receipts.
 */
export function createBotSpeaker(input: {
  readonly claim: {
    readonly scope: BotPublicationScope;
    readonly token: string;
    readonly segmentType: 'speech' | 'cross_ex';
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
  /**
   * `onSent` reports the samples of `job` sent so far, after each frame is
   * sent. `segmentEnded` says an incomplete job stopped at its segment end;
   * `stop` says why it stopped short otherwise.
   */
  readonly publish: (
    job: BotSpeechJob,
    signal: AbortSignal,
    onSent?: (samples: number) => void,
  ) => Promise<{
    readonly complete: boolean;
    readonly segmentEnded: boolean;
    readonly stop?: PublicationStop | null;
  }>;
  readonly nextId: () => string;
  readonly maxAttempts: number;
  /** `stage` names the work that failed: generate, synthesize or publish. */
  readonly failed: (error: unknown, stage: string) => void;
}) {
  const { scope, token, segmentType } = input.claim;
  const crossEx = segmentType === 'cross_ex';
  let running: { abort: AbortController; done: Promise<void> } | null = null,
    playing = false,
    stopped = false,
    /** The speech is over: delivered, or refused for good. */
    finished = false,
    attempts = 0,
    /** Cross-examination opens once, then answers each ended peer turn once. */
    owed = true,
    /** A new peer turn makes a held cross-examination answer stale. */
    stale = false;
  let stage = 'generate';
  let progress = freshProgress();
  /**
   * Publishes what is left of the held phrase; true once all of it was sent,
   * false when the segment or the turn ended. A phrase sent in full before a
   * refusal is already heard. Any other early stop (a stall the writer could
   * not re-anchor, ISSUE-497) is a failed attempt that resumes from the
   * samples sent, never a quietly finished speech.
   */
  const publishRest = async (phrase: BotSpeechJob, signal: AbortSignal) => {
    const from = progress.sent;
    if (from >= phrase.pcm.length) return true;
    playing = true;
    try {
      const { complete, segmentEnded, stop } = await input.publish(
        { ...phrase, pcm: phrase.pcm.subarray(from) },
        signal,
        (samples) => {
          progress.sent = Math.min(phrase.pcm.length, from + samples);
        },
      );
      if (!complete && !segmentEnded && !signal.aborted)
        throw stop
          ? publicationStopError(stop, STOPPED)
          : createAppError('INFRASTRUCTURE', STOPPED);
      return complete;
    } finally {
      playing = false;
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
    while (progress.spoken < phrases.length) {
      stage = 'synthesize';
      progress.synthesized ??= await input.synthesize(
        scope,
        token,
        input.nextId(),
        phrases[progress.spoken]!,
        signal,
      );
      await progress.synthesized.settle();
      stage = 'publish';
      if (!(await publishRest(progress.synthesized.value, signal))) return;
      progress.spoken += 1;
      progress.synthesized = null;
      progress.sent = 0;
    }
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
    if (isTransactionCapacityRefusal(error)) {
      if (crossEx) owed = true;
      return input.failed(error, stage);
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
