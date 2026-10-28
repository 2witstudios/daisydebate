import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import { startObservationPurges } from './observation-purges';
import { createRecordingLogger } from './test-loggers.test-support';
setupRitewayBun();

test('due observation purge jobs are delivered with one confirmed Redis purge per run (ISSUE-852)', async () => {
  const now = '2026-10-28T00:00:00.000Z';
  const calls: unknown[] = [];
  let purges = 0;
  const { logger } = createRecordingLogger();
  const worker = startObservationPurges({
    deliver: async (input, port) => {
      calls.push(input);
      await port.purge();
      return { succeeded: 2, retried: 0 };
    },
    purgeAll: async () => {
      purges++;
      return 3;
    },
    clock: fixedClock(now),
    logger,
    intervalMs: 5_000,
    timers: {
      setInterval: (_callback, ms) => {
        calls.push(ms);
        return 1;
      },
      clearInterval: () => {},
    },
  });
  await worker.stop();
  assert({
    given: 'a worker started with due jobs',
    should:
      'run at start on its short interval, bounded, and purge Redis through the delivery port',
    actual: { calls, purges },
    expected: { calls: [5_000, { now, limit: 128 }], purges: 1 },
  });
});
