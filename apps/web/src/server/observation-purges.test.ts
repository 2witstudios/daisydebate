import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import { startObservationPurges } from './observation-purges';
import {
  createEventRecorder,
  createRecordingLogger,
} from './test-loggers.test-support';
import { inertWaits, recordingWaits } from '../lib/manual-waits.test-support';
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
    owed: async () => 0,
    purgeAll: async () => {
      purges++;
      return 3;
    },
    clock: fixedClock(now),
    logger,
    intervalMs: 5_000,
    waits: recordingWaits(inertWaits, (event, ms) => {
      if (event === 'armed') calls.push(ms);
    }),
  });
  await worker.initial;
  await worker.stop();
  assert({
    given: 'a worker started with due jobs',
    should:
      'run at start, bounded, purge Redis through the delivery port, then come back on its short interval',
    actual: { calls, purges },
    expected: { calls: [{ now, limit: 128 }, 5_000], purges: 1 },
  });
});

test('a Redis failure never reports completion, on its retry or the idle runs after it (ISSUE-1007)', async () => {
  const now = '2026-10-28T00:00:00.000Z';
  const { logger, logged } = createEventRecorder();
  const waits = inertWaits;
  const start = (retried: number) =>
    startObservationPurges({
      deliver: async () => ({ succeeded: 0, retried }),
      owed: async () => 1,
      purgeAll: async () => 0,
      clock: fixedClock(now),
      logger,
      waits,
    });
  await start(1).stop();
  await start(0).stop();
  assert({
    given: 'a purge Redis refused, then an idle run while it backs off',
    should: 'log the failure once and completion never',
    actual: logged.map(({ event }) => event),
    expected: ['worker.run.failed'],
  });
});
