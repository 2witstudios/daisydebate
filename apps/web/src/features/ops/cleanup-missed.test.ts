import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createRetentionSweep } from '../../server/retention-sweep';
import { silentLogger } from '../../server/test-loggers.test-support';
import { createAlertRecorder, withAlertRecording } from './alert-recorder';
import {
  ALERT_THRESHOLDS,
  evaluateAlerts,
  readAlertSnapshot,
  runningWorkers,
} from './alert-state';
import { createScheduledWorker } from './scheduled-worker';

setupRitewayBun();

const START = Date.parse('2026-11-02T00:00:00.000Z');
const MINUTE_MS = 60_000;

/**
 * The composed signal path over an in-memory Redis: real run, real recorder,
 * real snapshot, real evaluation. Only time and the stores are faked.
 */
const world = () => {
  let nowMs = START;
  let targetFails = false;
  const clock = { now: () => new Date(nowMs).toISOString() };
  const markers = new Map<string, string>();
  const recorder = createAlertRecorder({
    clock,
    redis: {
      setEphemeral: async (key, value) => void markers.set(key, value),
      markOccurrenceSince: async (_key, value) => value,
      incrementWithExpiry: async () => 1,
      delete: async (key) => void markers.delete(key),
    },
  });
  const logger = withAlertRecording(silentLogger, recorder);
  const target = (name: string, breakable = false) => ({
    name,
    batchSize: 10,
    maxBatches: 1,
    purge: async () => {
      if (breakable && targetFails) throw new Error('database outage');
      return 0;
    },
  });
  const sweep = createRetentionSweep({
    clock,
    logger,
    targets: [
      target('retention.session', true),
      target('retention.verification'),
    ],
  });
  const workers = (['observation_purges', 'privacy_jobs'] as const).map(
    (name) =>
      createScheduledWorker({
        name,
        clock,
        logger,
        pass: async () => ({ deleted: 0, retried: 0, owed: 0 }),
      }),
  );
  return {
    breakTarget: () => {
      targetFails = true;
    },
    /** Advances time, running the sweep and both workers at each step. */
    runFor: async (ms: number) => {
      const end = nowMs + ms;
      for (; nowMs < end; nowMs += 5 * MINUTE_MS) {
        await sweep.run();
        for (const worker of workers) await worker.run();
      }
    },
    firing: async () =>
      evaluateAlerts(
        await readAlertSnapshot({
          clock,
          redis: { get: async (key) => markers.get(key) ?? null },
          local: { limiterUnavailableSince: () => null },
          workers: runningWorkers({ fileMaintenanceIntervalMs: null }),
        }),
      ).map(({ id }) => id),
  };
};

describe('cleanup_missed through the composed signal path (ISSUE-1007)', () => {
  test('one failing retention target beside healthy workers fires it', async () => {
    const { breakTarget, runFor, firing } = world();
    await runFor(10 * MINUTE_MS);
    breakTarget();
    await runFor(ALERT_THRESHOLDS.retentionMissedMs - 20 * MINUTE_MS);
    assert({
      given: 'a target failing for less than the threshold',
      should: 'not fire yet (negative control)',
      actual: await firing(),
      expected: [],
    });
    await runFor(20 * MINUTE_MS);
    assert({
      given:
        'one target failing past the threshold, while its sibling target and both workers keep succeeding every few minutes',
      should: 'fire cleanup_missed and no worker alert',
      actual: await firing(),
      expected: ['cleanup_missed'],
    });
  });

  test('every target succeeding fires nothing', async () => {
    const { runFor, firing } = world();
    await runFor(2 * ALERT_THRESHOLDS.retentionMissedMs);
    assert({
      given: 'the same world with every target succeeding',
      should: 'fire nothing',
      actual: await firing(),
      expected: [],
    });
  });
});
