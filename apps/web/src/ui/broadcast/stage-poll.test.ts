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

/** Reads that answer when the test says, so the test chooses the order they finish in. */
const heldReads = () => {
  const answer: ((value: number) => void)[] = [];
  return {
    read: () => new Promise<number>((done) => answer.push(done)),
    answer: (index: number) => answer[index]?.(index),
    started: () => answer.length,
  };
};

describe('startStagePoll', () => {
  test('every tick reads, so the watch samples once a second', () => {
    const timer = handTimer();
    const reads = heldReads();
    const stop = startStagePoll({
      read: reads.read,
      apply: () => undefined,
      every: timer.every,
    });
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
  test('a whole answer older than one already applied is never applied', async () => {
    const timer = handTimer();
    const reads = heldReads();
    const applied: number[] = [];
    const stop = startStagePoll({
      read: reads.read,
      apply: (answer) => applied.push(answer),
      every: timer.every,
    });
    timer.fire();
    timer.fire();
    reads.answer(1);
    await flush();
    reads.answer(0);
    await flush();
    reads.answer(2);
    await flush();
    stop();
    assert({
      given: 'three reads whose whole answers settle second, first, third',
      should: 'apply the second and the third, and drop the late first',
      actual: applied,
      expected: [1, 2],
    });
  });
  test('a read that rejects never escapes, and the next tick reads', async () => {
    const timer = handTimer();
    const rejections: unknown[] = [];
    const record = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', record);
    let reads = 0;
    const applied: unknown[] = [];
    try {
      const stop = startStagePoll({
        read: () => {
          reads += 1;
          return Promise.reject(new Error('body was cut off'));
        },
        apply: (answer) => applied.push(answer),
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
      should: 'keep reading, apply nothing and raise no unhandled rejection',
      actual: { reads, applied, rejections },
      expected: { reads: 2, applied: [], rejections: [] },
    });
  });
  test('an answer that settles after the stop is not applied', async () => {
    const timer = handTimer();
    const reads = heldReads();
    const applied: number[] = [];
    const stop = startStagePoll({
      read: reads.read,
      apply: (answer) => applied.push(answer),
      every: timer.every,
    });
    stop();
    reads.answer(0);
    await flush();
    assert({
      given: 'a read in flight when the poll stops',
      should: 'clear the timer and apply nothing',
      actual: { applied, cleared: timer.cleared },
      expected: { applied: [], cleared: true },
    });
  });
});
