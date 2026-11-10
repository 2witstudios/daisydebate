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

/** Reads that settle when the test says, each reporting whether its answer was fresh. */
const heldReads = () => {
  const settle: (() => void)[] = [];
  const fresh: boolean[] = [];
  return {
    read: (isFresh: () => boolean) =>
      new Promise<void>((done) => {
        settle.push(() => {
          fresh.push(isFresh());
          done();
        });
      }),
    settle: (index: number) => settle[index]?.(),
    fresh,
    started: () => settle.length,
  };
};

describe('startStagePoll', () => {
  test('every tick reads, so the watch samples once a second', () => {
    const timer = handTimer();
    const reads = heldReads();
    const stop = startStagePoll({ read: reads.read, every: timer.every });
    timer.fire();
    timer.fire();
    stop();
    assert({
      given: 'a first read still in flight across two ticks',
      should: 'start a read on each tick as well',
      actual: reads.started(),
      expected: 3,
    });
  });
  test('an answer older than one already applied is stale', async () => {
    const timer = handTimer();
    const reads = heldReads();
    const stop = startStagePoll({ read: reads.read, every: timer.every });
    timer.fire();
    timer.fire();
    reads.settle(1);
    reads.settle(0);
    reads.settle(2);
    await flush();
    stop();
    assert({
      given: 'three reads answering second, first, third',
      should: 'apply the second and the third, and drop the late first',
      actual: reads.fresh,
      expected: [true, false, true],
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
