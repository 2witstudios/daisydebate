import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import { startMessagingFileMaintenance } from './file-maintenance';
import {
  createEventRecorder,
  createRecordingLogger,
} from './test-loggers.test-support';
import {
  inertWaits,
  manualWaits,
  recordingWaits,
} from '../lib/manual-waits.test-support';
setupRitewayBun();
test('explicit file cleanup schedule bounds work and drains its current vendor acknowledgement on shutdown', async () => {
  const now = '2026-10-10T00:00:00.000Z';
  const calls: unknown[] = [];
  const manual = manualWaits();
  /** Fires the next one-second run, if one is armed. */
  const tick = async () => {
    await manual.tasks.get(1000)?.();
  };
  let resolve = () => {};
  const pending = new Promise<void>((done) => {
    resolve = done;
  });
  const { logger } = createRecordingLogger();
  const remove = async (_key: string) => {};
  const worker = startMessagingFileMaintenance({
    maintenance: {
      run: async (input) => {
        calls.push(input);
        await pending;
        return { expiredChannels: 1, acknowledged: 1 };
      },
    },
    config: { intervalMs: 1000, maxItems: 3 },
    remove,
    clock: fixedClock(now),
    logger,
    // Each wait armed is its length; one a stop ends is 1.
    waits: recordingWaits(manual.waits, (event, ms) =>
      calls.push(event === 'armed' ? ms : 1),
    ),
  });
  await tick();
  let stopped = false;
  const stopping = worker.stop().then(() => {
    stopped = true;
  });
  await tick();
  assert({
    given: 'one active cleanup and overlapping ticks plus shutdown',
    should: 'run once and wait for the physical ACK',
    actual: [calls.filter((call) => typeof call === 'object').length, stopped],
    expected: [1, false],
  });
  resolve();
  await stopping;
  assert({
    given: 'acknowledged current batch',
    should: 'allow shutdown after exact trusted bounds and time',
    actual: [stopped, calls],
    expected: [true, [{ now, maxItems: 3, remove }, 1000, 1000, 1]],
  });
});

test('a refused vendor deletion reports failure and a clean pass completion', async () => {
  const { logger, logged } = createEventRecorder();
  const start = (run: () => Promise<{ acknowledged: number }>) =>
    startMessagingFileMaintenance({
      maintenance: {
        run: async () => ({ expiredChannels: 0, ...(await run()) }),
      },
      config: { intervalMs: 1000, maxItems: 3 },
      remove: async () => {},
      clock: fixedClock('2026-10-10T00:00:00.000Z'),
      logger,
      waits: inertWaits,
    });
  await start(async () => {
    throw new Error('vendor refused');
  }).stop();
  await start(async () => ({ acknowledged: 2 })).stop();
  assert({
    given: 'a pass that threw, then one that acknowledged everything',
    should: 'report each as what it was, under its own name',
    actual: logged.map(({ event, fields }) => [event, fields.operation]),
    expected: [
      ['worker.run.failed', 'messaging_file_maintenance'],
      ['worker.run.completed', 'messaging_file_maintenance'],
    ],
  });
});

test('a full batch of acknowledged deletions may leave more, so it owes', async () => {
  const { logger, logged } = createEventRecorder();
  await startMessagingFileMaintenance({
    maintenance: {
      run: async () => ({ expiredChannels: 0, acknowledged: 3 }),
    },
    config: { intervalMs: 1000, maxItems: 3 },
    remove: async () => {},
    clock: fixedClock('2026-10-10T00:00:00.000Z'),
    logger,
    waits: inertWaits,
  }).stop();
  assert({
    given: 'a pass that filled its batch',
    should: 'not report completion',
    actual: logged,
    expected: [],
  });
});
