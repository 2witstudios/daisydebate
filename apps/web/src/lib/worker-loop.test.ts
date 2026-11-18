import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { LoopPass } from './idle-backoff';
import { startWorkerLoop, type WorkWake } from './worker-loop';
import type { OneShotTimer } from './worker-timers';

setupRitewayBun();

/** One-shot timers fired by hand; records each armed wait. */
const manualOneShot = () => {
  const armed = new Map<number, { ms: number; run: () => void }>();
  let next = 0;
  const waits: number[] = [];
  const timers: OneShotTimer = {
    setTimeout: (run, ms) => {
      next += 1;
      armed.set(next, { ms, run });
      waits.push(ms);
      return next;
    },
    clearTimeout: (handle) => {
      armed.delete(handle as number);
    },
  };
  const fire = async () => {
    const [entry] = [...armed];
    if (!entry) throw new Error('nothing armed');
    armed.delete(entry[0]);
    entry[1].run();
    await settle();
  };
  return { timers, waits, armed, fire };
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const manualWake = () => {
  const listeners = new Set<() => void>();
  const wake: WorkWake = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { wake, signal: () => listeners.forEach((listener) => listener()) };
};

test('an idle worker backs off and a wake brings it straight back', async () => {
  const clock = manualOneShot();
  const signals = manualWake();
  let passes = 0;
  const loop = startWorkerLoop({
    run: async () => {
      passes += 1;
      return 'idle';
    },
    backoff: { busyMs: 100, idleMaxMs: 800 },
    timers: clock.timers,
    failed: () => undefined,
    wake: signals.wake,
  });
  await loop.started;
  await settle();
  for (let tick = 0; tick < 4; tick += 1) await clock.fire();
  assert({
    given: 'five empty passes',
    should: 'arm growing waits up to the cap',
    actual: clock.waits,
    expected: [100, 200, 400, 800, 800],
  });
  signals.signal();
  await settle();
  assert({
    given: 'a wake while waiting',
    should: 'pass at once, drop the long wait and start again at busy pace',
    actual: {
      passes,
      armed: [...clock.armed.values()].map(({ ms }) => ms),
    },
    expected: { passes: 6, armed: [100] },
  });
  await loop.stop();
});

test('a pass that finds work keeps the busy pace', async () => {
  const clock = manualOneShot();
  const found: LoopPass[] = ['worked', 'worked', 'idle'];
  const loop = startWorkerLoop({
    run: async () => found.shift() ?? 'idle',
    backoff: { busyMs: 100, idleMaxMs: 800 },
    timers: clock.timers,
    failed: () => undefined,
  });
  await loop.started;
  await settle();
  await clock.fire();
  await clock.fire();
  await clock.fire();
  assert({
    given: 'two passes with work, then empty ones',
    should: 'stay at busy pace while working, then back off',
    actual: clock.waits,
    expected: [100, 100, 200, 400],
  });
  await loop.stop();
});

test('a wake during a pass runs one more pass straight after', async () => {
  const clock = manualOneShot();
  const signals = manualWake();
  let release = () => {};
  let passes = 0;
  const loop = startWorkerLoop({
    run: () => {
      passes += 1;
      return passes === 1
        ? new Promise<LoopPass>((resolve) => {
            release = () => resolve('idle');
          })
        : Promise.resolve('idle');
    },
    backoff: { busyMs: 100, idleMaxMs: 800 },
    timers: clock.timers,
    failed: () => undefined,
    wake: signals.wake,
  });
  signals.signal();
  signals.signal();
  assert({
    given: 'two wakes while the first pass runs',
    should: 'never overlap it',
    actual: passes,
    expected: 1,
  });
  release();
  await settle();
  await settle();
  assert({
    given: 'the first pass ending',
    should: 'run exactly one more pass for the wakes',
    actual: passes,
    expected: 2,
  });
  await loop.stop();
});

test('a failed pass is reported and backs off', async () => {
  const clock = manualOneShot();
  const failures: unknown[] = [];
  const loop = startWorkerLoop({
    run: () => Promise.reject(new Error('store down')),
    backoff: { busyMs: 100, idleMaxMs: 800 },
    timers: clock.timers,
    failed: (error) => failures.push(error),
  });
  await loop.started;
  await settle();
  await clock.fire();
  assert({
    given: 'two failing passes',
    should: 'report each and grow the wait',
    actual: { failures: failures.length, waits: clock.waits },
    expected: { failures: 2, waits: [100, 200] },
  });
  await loop.stop();
});

test('stop waits for the pass in flight and arms nothing after', async () => {
  const clock = manualOneShot();
  const signals = manualWake();
  let release = () => {};
  let passes = 0;
  const loop = startWorkerLoop({
    run: () => {
      passes += 1;
      return new Promise<LoopPass>((resolve) => {
        release = () => resolve('worked');
      });
    },
    backoff: { busyMs: 100, idleMaxMs: 800 },
    timers: clock.timers,
    failed: () => undefined,
    wake: signals.wake,
  });
  let stopped = false;
  const stopping = loop.stop().then(() => {
    stopped = true;
  });
  await settle();
  assert({
    given: 'stop while a pass runs',
    should: 'wait for it',
    actual: stopped,
    expected: false,
  });
  release();
  await stopping;
  signals.signal();
  await settle();
  assert({
    given: 'the pass ended after stop, then a wake',
    should: 'arm no timer and run no further pass',
    actual: { armed: clock.armed.size, passes },
    expected: { armed: 0, passes: 1 },
  });
});
