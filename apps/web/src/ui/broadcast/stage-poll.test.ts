import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { startStagePoll } from './stage-poll';

setupRitewayBun();

const flush = () => new Promise<void>((done) => setTimeout(done, 0));

/** A timer the test fires by hand, so no test waits on a clock. */
const handTimer = () => {
  let tick: (() => void) | null = null;
  let cleared = false;
  return {
    every: (run: () => void) => {
      tick = run;
      return () => {
        cleared = true;
      };
    },
    fire: () => tick?.(),
    get cleared() {
      return cleared;
    },
  };
};

describe('startStagePoll', () => {
  test('a tick while a read is in flight is skipped', async () => {
    const timer = handTimer();
    const pending: (() => void)[] = [];
    let reads = 0;
    const stop = startStagePoll({
      read: () => {
        reads += 1;
        return new Promise<void>((done) => pending.push(done));
      },
      every: timer.every,
    });
    timer.fire();
    timer.fire();
    const whileReading = reads;
    pending.shift()?.();
    await flush();
    timer.fire();
    stop();
    assert({
      given: 'the first read still in flight across two ticks, then settled',
      should: 'read once until it settles, then read on the next tick',
      actual: { whileReading, reads },
      expected: { whileReading: 1, reads: 2 },
    });
  });
  test('a read that rejects never escapes, and the next tick reads', async () => {
    const timer = handTimer();
    const rejections: unknown[] = [];
    const record = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', record);
    let reads = 0;
    try {
      const stop = startStagePoll({
        read: () => {
          reads += 1;
          return Promise.reject(new Error('body was cut off'));
        },
        every: timer.every,
      });
      await flush();
      timer.fire();
      await flush();
      stop();
    } finally {
      process.off('unhandledRejection', record);
    }
    assert({
      given: 'reads that reject',
      should: 'keep reading and raise no unhandled rejection',
      actual: { reads, rejections },
      expected: { reads: 2, rejections: [] },
    });
  });
  test('the first read starts at once and stopping clears the timer', () => {
    const timer = handTimer();
    let reads = 0;
    const stop = startStagePoll({
      read: () => {
        reads += 1;
        return Promise.resolve();
      },
      every: timer.every,
    });
    const atStart = reads;
    stop();
    assert({
      given: 'a poll started then stopped',
      should: 'have read once and cleared its timer',
      actual: { atStart, cleared: timer.cleared },
      expected: { atStart: 1, cleared: true },
    });
  });
});
