import type { WorkerTimers } from '../../lib/worker-timers';

/** Joins one owned claim's receipts and speech; receipts never await model, media or relay work. */
export function createBotSeat(input: {
  readonly control: { readonly pulse: () => Promise<unknown> };
  readonly speaker: {
    readonly wake: () => void;
    readonly stop: () => Promise<void>;
  };
  /**
   * The claim's native publication: joined with the seat, ahead of speech,
   * and ended with it, after the speaker stops (ISSUE-514-r1).
   */
  readonly publication: {
    readonly start: () => void;
    readonly close: () => Promise<void>;
  };
  /**
   * The bot's own hearing, present only for cross-examination, where peer
   * activity can cancel a phrase: joined with the seat and ended with it
   * (ISSUE-764).
   */
  readonly feed: {
    readonly start: () => void;
    readonly poll: () => Promise<void>;
    readonly close: () => Promise<void>;
  } | null;
  readonly pollMs: number;
  readonly timers: WorkerTimers;
  /**
   * `stage` is poll when the bot's hearing failed, or close when the seat
   * could not close what it had started, on stop or after a failed start.
   */
  readonly failed: (error: unknown, stage: string) => void;
}) {
  let polling: Promise<void> | null = null;
  const poll = (): Promise<void> => {
    polling ??= (async () => {
      try {
        await input.feed?.poll();
        input.speaker.wake();
      } catch (error) {
        input.failed(error, 'poll');
      } finally {
        polling = null;
      }
    })();
    return polling;
  };
  /**
   * Closes what the seat started, its publication and then its hearing.
   * Each close is attempted, and each failure is reported on its own (stage
   * close) with its own code; it never throws, so a stop keeps the speaker's
   * own error (ISSUE-789).
   */
  const closeStarted = async () => {
    const { publication, feed } = input;
    for (const close of [() => publication.close(), () => feed?.close()])
      await Promise.resolve()
        .then(close)
        .catch((error: unknown) => input.failed(error, 'close'));
  };
  input.publication.start();
  let timer: unknown = null;
  try {
    input.feed?.start();
    if (input.feed) timer = input.timers.setInterval(poll, input.pollMs);
  } catch (error) {
    // A seat that fails to start owns nothing it started (ISSUE-789).
    void closeStarted();
    throw error;
  }
  return {
    pulse: () => {
      input.speaker.wake();
      return input.control.pulse();
    },
    async stop() {
      if (timer !== null) input.timers.clearInterval(timer);
      await polling;
      try {
        await input.speaker.stop();
      } finally {
        await closeStarted();
      }
    },
  };
}
