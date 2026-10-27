import { assert, setupRitewayBun, test } from 'riteway/bun';
import { startMailIntentService } from './mail-service';

setupRitewayBun();

const manualTimers = () => {
  const ticks: Array<() => Promise<void>> = [];
  let cleared = 0;
  return {
    ticks,
    cleared: () => cleared,
    timers: {
      setInterval: (task: () => Promise<void>) => {
        ticks.push(task);
        return ticks.length;
      },
      clearInterval: () => {
        cleared += 1;
      },
    },
  };
};

test('runs a batch at start and per tick, never two at once, and stops cleanly', async () => {
  const { ticks, timers, cleared } = manualTimers();
  const limits: number[] = [];
  let release = () => {};
  const service = startMailIntentService({
    run: (limit) => {
      limits.push(limit);
      return new Promise<number>((resolve) => {
        release = () => resolve(0);
      });
    },
    batch: 10,
    everyMs: 15_000,
    timers,
    failed: () => {},
  });
  const overlapping = ticks[0]!();
  release();
  await Promise.all([service.started, overlapping]);
  const next = ticks[0]!();
  release();
  await next;
  await service.stop();
  await ticks[0]!();
  assert({
    given: 'a tick while a batch runs, a later tick, and a tick after stop',
    should: 'skip the overlap, run the later one, and run nothing after stop',
    actual: { limits, cleared: cleared() },
    expected: { limits: [10, 10], cleared: 1 },
  });
});

test('a failed batch is reported and the loop carries on', async () => {
  const { ticks, timers } = manualTimers();
  const failures: unknown[] = [];
  const service = startMailIntentService({
    run: async () => {
      throw new Error('database down');
    },
    batch: 10,
    everyMs: 15_000,
    timers,
    failed: (error) => failures.push(error),
  });
  await service.started;
  await ticks[0]!();
  await service.stop();
  assert({
    given: 'a store that fails on every batch',
    should: 'report each failure without stopping the loop',
    actual: failures.length,
    expected: 2,
  });
});
