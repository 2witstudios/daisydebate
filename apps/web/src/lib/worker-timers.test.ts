import { assert, setupRitewayBun, test } from 'riteway/bun';
import { startSingleFlightWorker } from './worker-timers';
import { manualTimers } from './worker-timers.test-support';
setupRitewayBun();

test('a single-flight worker runs at once, never overlaps, reports failures and stops after its run', async () => {
  const { tasks, timers } = manualTimers();
  const failure = new Error('run failed');
  const failed: unknown[] = [];
  let runs = 0;
  let release!: () => void;
  const held = new Promise<void>((done) => {
    release = done;
  });
  const worker = startSingleFlightWorker({
    run: async () => {
      runs += 1;
      await held;
      throw failure;
    },
    everyMs: 500,
    timers,
    failed: (error) => failed.push(error),
  });
  const overlapping = tasks.get(500)?.();
  let stopped = false;
  const stopping = worker.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  const beforeRelease = stopped;
  release();
  await Promise.all([worker.started, overlapping, stopping]);
  assert({
    given:
      'a run still in flight when its tick fires, a failing run, and a stop requested mid-run',
    should:
      'run once, report the failure, clear the interval and finish stopping only after the run',
    actual: { runs, failed, beforeRelease, stopped, cleared: tasks.has(500) },
    expected: {
      runs: 1,
      failed: [failure],
      beforeRelease: false,
      stopped: true,
      cleared: false,
    },
  });
});
