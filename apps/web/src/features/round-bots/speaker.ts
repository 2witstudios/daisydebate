import type { BotPublicationScope } from '@daisy/db/bot-publication';
import { isTransactionCapacityRefusal } from '@daisy/db';
import { isAppError } from '@daisy/errors';

type Job = {
  readonly scope: BotPublicationScope;
  readonly token: string;
  readonly phraseId: string;
  readonly text: string;
  readonly pcm: Int16Array;
  readonly sampleRate: 24000;
  readonly channels: 1;
};
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
  synthesized: Answer<Job> | null;
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
export type PeerActivity =
  'speech-start' | 'end-of-turn' | 'barge-in' | 'unknown';
/**
 * One speaking turn at a time per owned claim. Phrases stay in memory; capture
 * alone credits transcript. Refused authority and refused pool admission wait
 * for the next wake without spending an attempt; a pool refusal resumes the turn
 * where it stopped, so no answer is bought and no phrase is spoken twice. The
 * speaker never issues floor commands or touches control receipts.
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
  ) => Promise<Answer<Job>>;
  /** `onSent` reports the samples of `job` sent so far, after each frame is sent. */
  readonly publish: (
    job: Job,
    signal: AbortSignal,
    onSent?: (samples: number) => void,
  ) => Promise<{ readonly complete: boolean }>;
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
    delivered = false,
    attempts = 0,
    /** Cross-examination opens once, then answers each ended peer turn once. */
    owed = true;
  let stage = 'generate';
  let progress = freshProgress();
  /**
   * Publishes what is left of the held phrase; true once all of it was sent.
   * A phrase sent in full before a refusal is already heard.
   */
  const publishRest = async (phrase: Job, signal: AbortSignal) => {
    const from = progress.sent;
    if (from >= phrase.pcm.length) return true;
    playing = true;
    try {
      const { complete } = await input.publish(
        { ...phrase, pcm: phrase.pcm.subarray(from) },
        signal,
        (samples) => {
          progress.sent = Math.min(phrase.pcm.length, from + samples);
        },
      );
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
  const turn = async (abort: AbortController) => {
    try {
      await deliver(abort.signal);
      progress = freshProgress();
      if (!crossEx) delivered = true;
    } catch (error) {
      if (abort.signal.aborted) return void (progress = freshProgress());
      // Pool backpressure is a deferral: the next wake resumes at the refused step.
      if (isTransactionCapacityRefusal(error)) {
        if (crossEx) owed = true;
        return input.failed(error, stage);
      }
      progress = freshProgress();
      if (isAppError(error) && error.code === 'CONFLICT') {
        if (crossEx) owed = true;
        return;
      }
      attempts += 1;
      if (crossEx) owed = attempts < input.maxAttempts;
      input.failed(error, stage);
    } finally {
      running = null;
    }
  };
  const cancel = () => running?.abort.abort();
  return {
    wake() {
      if (stopped || running || delivered || attempts >= input.maxAttempts)
        return;
      if (crossEx && !owed) return;
      owed = false;
      const abort = new AbortController();
      running = { abort, done: Promise.resolve() };
      running.done = turn(abort);
    },
    peer(kind: PeerActivity) {
      if (!crossEx) return;
      if (kind === 'end-of-turn') {
        owed = true;
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
