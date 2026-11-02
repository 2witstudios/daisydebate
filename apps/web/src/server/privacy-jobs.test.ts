import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import { startPrivacyJobs } from './privacy-jobs';
import { createEventRecorder } from './test-loggers.test-support';

setupRitewayBun();
const now = '2026-10-28T00:00:00.000Z';

test('due vendor deletion jobs are delivered with per-attempt backoff (ISSUE-833)', async () => {
  const calls: unknown[] = [];
  const { logger } = createEventRecorder();
  const worker = startPrivacyJobs({
    owed: async () => 0,
    due: async ({ now, limit }) => {
      calls.push({ due: { now, limit } });
      return [
        {
          id: 'abcdefghijklmnopqrstuvwx',
          vendor: 'messaging-typing' as const,
          attempts: 0,
        },
        {
          id: 'bcdefghijklmnopqrstuvwxy',
          vendor: 'messaging-typing' as const,
          attempts: 2,
        },
      ];
    },
    deliver: async (job, at, retryAt) => {
      calls.push({ delivered: job.id, vendor: job.vendor, at, retryAt });
      return 'succeeded';
    },
    clock: fixedClock(now),
    logger,
    intervalMs: 60_000,
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
    given: 'two due pending vendor deletion jobs',
    should:
      'read one bounded batch, deliver each in read order with a retry deadline that backs off by attempts, and run at start on its interval',
    actual: calls,
    expected: [
      60_000,
      { due: { now, limit: 32 } },
      {
        delivered: 'abcdefghijklmnopqrstuvwx',
        vendor: 'messaging-typing',
        at: now,
        retryAt: '2026-10-28T00:01:00.000Z',
      },
      {
        delivered: 'bcdefghijklmnopqrstuvwxy',
        vendor: 'messaging-typing',
        at: now,
        retryAt: '2026-10-28T00:04:00.000Z',
      },
    ],
  });
});

test('a failed due-read reports failure and an empty batch reports completion', async () => {
  const { logger, logged: events } = createEventRecorder();
  let runs = 0;
  const failing = startPrivacyJobs({
    due: async () => {
      runs += 1;
      throw new Error('database outage');
    },
    deliver: async () => 'retry',
    owed: async () => 0,
    clock: fixedClock(now),
    logger,
    intervalMs: 60_000,
    timers: {
      setInterval: () => 1,
      clearInterval: () => {},
    },
  });
  await failing.stop();
  const empty = startPrivacyJobs({
    due: async () => [],
    deliver: async () => 'retry',
    owed: async () => 0,
    clock: fixedClock(now),
    logger,
    intervalMs: 60_000,
    timers: {
      setInterval: () => 1,
      clearInterval: () => {},
    },
  });
  await empty.stop();
  assert({
    given: 'a due-read outage, then an empty batch on a second worker',
    should:
      'report the failed run once and the completed empty run, stopping cleanly both times',
    actual: {
      runs,
      failedReported: events.filter(
        (event) => event.event === 'worker.run.failed',
      ).length,
      completedReported: events.filter(
        (event) => event.event === 'worker.run.completed',
      ).length,
    },
    expected: { runs: 1, failedReported: 1, completedReported: 1 },
  });
});

test('a vendor failure never reports completion, on its retry or the idle runs after it', async () => {
  const { logger, logged: events } = createEventRecorder();
  const timers = { setInterval: () => 1, clearInterval: () => {} };
  const retried = startPrivacyJobs({
    due: async () => [{ id: 'job', vendor: 'messaging-typing', attempts: 0 }],
    deliver: async () => 'retry',
    owed: async () => 1,
    clock: fixedClock(now),
    logger,
    timers,
  });
  await retried.stop();
  const idle = startPrivacyJobs({
    due: async () => [],
    deliver: async () => 'retry',
    owed: async () => 1,
    clock: fixedClock(now),
    logger,
    timers,
  });
  await idle.stop();
  assert({
    given: 'a job the vendor refused, then an idle run while it backs off',
    should: 'log the failure once and completion never',
    actual: events.map(({ event }) => event),
    expected: ['worker.run.failed'],
  });
});
