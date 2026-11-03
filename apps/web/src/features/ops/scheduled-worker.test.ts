import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import { createEventRecorder } from '../../server/test-loggers.test-support';
import {
  createScheduledWorker,
  workerOutcome,
  type WorkerPass,
} from './scheduled-worker';

setupRitewayBun();

const NOW = '2026-11-02T00:00:00.000Z';

const eventsOf = async (pass: (now: string) => Promise<WorkerPass>) => {
  const { logger, logged } = createEventRecorder();
  await createScheduledWorker({
    name: 'privacy_jobs',
    pass,
    clock: fixedClock(NOW),
    logger,
  }).run();
  return logged.map(({ event }) => event);
};

describe('workerOutcome', () => {
  test('decides from what the pass did and what it still owes', () => {
    assert({
      given: 'a pass that retried a job',
      should: 'be failed, even if it delivered others',
      actual: workerOutcome({ deleted: 3, retried: 1, owed: 1 }),
      expected: 'failed',
    });
    assert({
      given: 'an idle pass while an earlier job sits in backoff',
      should: 'be waiting, not healthy',
      actual: workerOutcome({ deleted: 0, retried: 0, owed: 1 }),
      expected: 'waiting',
    });
    assert({
      given: 'a pass that delivered another job while one sits in backoff',
      should: 'be waiting, not healthy',
      actual: workerOutcome({ deleted: 2, retried: 0, owed: 1 }),
      expected: 'waiting',
    });
    assert({
      given: 'an idle pass that owes nothing',
      should: 'be healthy',
      actual: workerOutcome({ deleted: 0, retried: 0, owed: 0 }),
      expected: 'healthy',
    });
  });
});

describe('createScheduledWorker', () => {
  test('logs only what happened', async () => {
    assert({
      given: 'a pass that owes nothing',
      should: 'log completed',
      actual: await eventsOf(async () => ({
        deleted: 1,
        retried: 0,
        owed: 0,
      })),
      expected: ['worker.run.completed'],
    });
    assert({
      given: 'a pass that retried every job',
      should: 'log failed and never completed',
      actual: await eventsOf(async () => ({
        deleted: 0,
        retried: 2,
        owed: 2,
      })),
      expected: ['worker.run.failed'],
    });
    assert({
      given: 'an idle pass with a job in backoff',
      should: 'log nothing, so the alert marker is not refreshed',
      actual: await eventsOf(async () => ({
        deleted: 0,
        retried: 0,
        owed: 1,
      })),
      expected: [],
    });
    assert({
      given: 'a pass that throws',
      should: 'log failed without surfacing the error',
      actual: await eventsOf(async () => {
        throw new Error('database outage');
      }),
      expected: ['worker.run.failed'],
    });
  });

  test('carries bounded fields only', async () => {
    const { logger, logged } = createEventRecorder();
    await createScheduledWorker({
      name: 'observation_purges',
      pass: async () => ({ deleted: 1, retried: 2, owed: 2 }),
      clock: fixedClock(NOW),
      logger,
    }).run();
    assert({
      given: 'a failed run',
      should: 'name the worker and what it still owes',
      actual: logged[0]?.fields,
      expected: {
        operation: 'observation_purges',
        errorCode: 'INFRASTRUCTURE',
        deleted: 1,
        pending: 2,
      },
    });
  });
});
