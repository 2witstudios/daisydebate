import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import { startMessagingFileMaintenance } from './file-maintenance';
import { createRecordingLogger } from './test-loggers.test-support';
setupRitewayBun();
test('explicit file cleanup schedule bounds work and drains its current vendor acknowledgement on shutdown', async () => {
  const now = '2026-10-10T00:00:00.000Z';
  const calls: unknown[] = [];
  let tick = () => {};
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
    timers: {
      setInterval: (callback, ms) => {
        tick = callback;
        calls.push(ms);
        return 1;
      },
      clearInterval: (handle) => {
        calls.push(handle);
      },
    },
  });
  tick();
  let stopped = false;
  const stopping = worker.stop().then(() => {
    stopped = true;
  });
  tick();
  assert({
    given: 'one active cleanup and overlapping ticks plus shutdown',
    should: 'run once and wait for the physical ACK',
    actual: [calls.length, stopped],
    expected: [3, false],
  });
  resolve();
  await stopping;
  assert({
    given: 'acknowledged current batch',
    should: 'allow shutdown after exact trusted bounds and time',
    actual: [stopped, calls],
    expected: [true, [1000, { now, maxItems: 3, remove }, 1]],
  });
});
