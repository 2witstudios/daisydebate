import type { WorkerTimers } from '../../server/worker-timers';

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
  /** Present only for cross-examination, where peer activity can cancel a phrase. */
  readonly feed: { readonly poll: () => Promise<void> } | null;
  readonly pollMs: number;
  readonly timers: WorkerTimers;
  /** `stage` is always poll: the peer activity feed failed. */
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
  input.publication.start();
  const timer = input.feed
    ? input.timers.setInterval(poll, input.pollMs)
    : null;
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
        await input.publication.close();
      }
    },
  };
}
