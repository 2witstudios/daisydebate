import { assert, setupRitewayBun, test } from 'riteway/bun';
import { startMailQueueWorker } from './queue-worker';
import { manualTimers } from '../../lib/worker-timers.test-support';

setupRitewayBun();

test('a queue sending mail keeps its pace; an empty one backs off', async () => {
  const { timers, waits, nextPass } = manualTimers();
  const limits: number[] = [];
  const sent = [3, 1, 0, 0];
  const service = startMailQueueWorker({
    run: async (limit) => {
      limits.push(limit);
      return sent.shift() ?? 0;
    },
    batch: 10,
    everyMs: 5_000,
    timers,
    failed: () => {},
  });
  await service.started;
  await nextPass();
  await nextPass();
  await nextPass();
  await service.stop();
  assert({
    given: 'two batches that send mail, then two that find none, then a stop',
    should:
      'run each batch with its limit, at 15 s while sending, then wait longer',
    actual: { limits, waits },
    expected: {
      limits: [10, 10, 10, 10],
      waits: [5_000, 5_000, 10_000, 15_000],
    },
  });
});

test('a failed batch is reported and the loop carries on', async () => {
  const { timers, nextPass } = manualTimers();
  const failures: unknown[] = [];
  const service = startMailQueueWorker({
    run: async () => {
      throw new Error('database down');
    },
    batch: 10,
    everyMs: 15_000,
    timers,
    failed: (error) => failures.push(error),
  });
  await service.started;
  await nextPass();
  await service.stop();
  assert({
    given: 'a store that fails on every batch',
    should: 'report each failure without stopping the loop',
    actual: failures.length,
    expected: 2,
  });
});
