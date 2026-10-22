import type { BotPublicationScope } from '@daisy/db/bot-publication';
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
export type PeerActivity =
  'speech-start' | 'end-of-turn' | 'barge-in' | 'unknown';
/**
 * One speaking turn at a time per owned claim. Phrases stay in memory; capture
 * alone credits transcript. Refused authority waits for the next wake; it never
 * issues floor commands or touches control receipts.
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
  ) => Promise<{ readonly text: string; readonly phrases: readonly string[] }>;
  readonly synthesize: (
    scope: BotPublicationScope,
    token: string,
    phraseId: string,
    text: string,
    signal: AbortSignal,
  ) => Promise<Job>;
  readonly publish: (
    job: Job,
    signal: AbortSignal,
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
  const deliver = async (signal: AbortSignal) => {
    stage = 'generate';
    const { phrases } = await input.generate(scope, token, signal);
    for (const text of phrases) {
      stage = 'synthesize';
      const job = await input.synthesize(
        scope,
        token,
        input.nextId(),
        text,
        signal,
      );
      playing = true;
      stage = 'publish';
      try {
        if (!(await input.publish(job, signal)).complete) return;
      } finally {
        playing = false;
      }
    }
  };
  const turn = async (abort: AbortController) => {
    try {
      await deliver(abort.signal);
      if (!crossEx) delivered = true;
    } catch (error) {
      if (abort.signal.aborted) return;
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
