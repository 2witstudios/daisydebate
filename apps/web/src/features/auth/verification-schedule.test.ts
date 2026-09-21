import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { startVerificationCleanup } from './verification-cleanup';

setupRitewayBun();

const HOUR = 3_600_000;

describe('verification cleanup schedule', () => {
  const fakeTimers = () => {
    const state: {
      tick?: () => unknown;
      cleared: unknown[];
      interval?: number;
    } = { cleared: [] };
    return {
      state,
      timers: {
        setInterval: (tick: () => unknown, ms: number) => {
          state.tick = tick;
          state.interval = ms;
          return 'handle';
        },
        clearInterval: (handle: unknown) => void state.cleared.push(handle),
      },
    };
  };

  test('runs hourly, keeps running after a failed run, and stops cleanly', async () => {
    const { state, timers } = fakeTimers();
    const outcomes: boolean[] = [];
    const runs = [false, true];
    const schedule = startVerificationCleanup({
      cleanup: {
        run: async () => {
          const ok = runs.shift() ?? true;
          outcomes.push(ok);
          return { ok, deleted: 0, batches: 0 };
        },
      },
      timers,
    });
    // The tick returns its run's completion, so no timing is inferred.
    await state.tick?.();
    await state.tick?.();
    schedule.stop();
    assert({
      given: 'two sequential ticks where the first run fails',
      should: 'schedule every hour, run both ticks and clear the timer on stop',
      actual: { interval: state.interval, outcomes, cleared: state.cleared },
      expected: {
        interval: HOUR,
        outcomes: [false, true],
        cleared: ['handle'],
      },
    });
  });

  test('a tick that starts while the previous run is still going is skipped', async () => {
    const { state, timers } = fakeTimers();
    let started = 0;
    let release: () => void = () => undefined;
    startVerificationCleanup({
      cleanup: {
        run: () => {
          started += 1;
          return new Promise((resolve) => {
            release = () => resolve({ ok: true, deleted: 0, batches: 0 });
          });
        },
      },
      timers,
    });
    const first = state.tick?.();
    const second = state.tick?.();
    release();
    await first;
    assert({
      given: 'an hourly tick arriving during a long run',
      should: 'not start a second overlapping run in the same process',
      actual: { started, secondTickRan: second !== undefined },
      expected: { started: 1, secondTickRan: false },
    });
  });
  test('runOnStart runs one cleanup immediately so short-lived processes still purge', async () => {
    const { state, timers } = fakeTimers();
    let runs = 0;
    const schedule = startVerificationCleanup({
      cleanup: {
        run: async () => {
          runs += 1;
          return { ok: true, deleted: 0, batches: 0 };
        },
      },
      timers,
      runOnStart: true,
    });
    await schedule.initial;
    await state.tick?.();
    assert({
      given: 'a schedule started with runOnStart, then its first hourly tick',
      should: 'have run once at start and once for the tick',
      actual: runs,
      expected: 2,
    });
  });
  test('stop clears the timer, stops the cleanup and waits for a run in progress', async () => {
    const { state, timers } = fakeTimers();
    let release: () => void = () => undefined;
    let cleanupStopped = false;
    let runsStarted = 0;
    const schedule = startVerificationCleanup({
      cleanup: {
        run: () => {
          runsStarted += 1;
          return new Promise((resolve) => {
            release = () => resolve({ ok: true, deleted: 0, batches: 0 });
          });
        },
        stop: () => {
          cleanupStopped = true;
        },
      },
      timers,
    });
    void state.tick?.();
    let settled = false;
    const stopping = schedule.stop().then(() => {
      settled = true;
    });
    // Drain the microtask queue (no timers): a stop that did not wait for the
    // run would already have resolved by now.
    for (let hop = 0; hop < 10; hop += 1) await Promise.resolve();
    const beforeRelease = { settled, cleanupStopped };
    const afterStopTick = state.tick?.();
    release();
    await stopping;
    assert({
      given: 'a stop while a cleanup run is still deleting',
      should:
        'stop the cleanup, resolve only once that run ends, and start no new run',
      actual: {
        beforeRelease,
        settled,
        cleared: state.cleared,
        runsStarted,
        afterStopTick,
      },
      expected: {
        beforeRelease: { settled: false, cleanupStopped: true },
        settled: true,
        cleared: ['handle'],
        runsStarted: 1,
        afterStopTick: undefined,
      },
    });
  });
});
