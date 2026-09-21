import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import {
  createVerificationCleanup,
  startVerificationCleanup,
} from './verification-cleanup';

setupRitewayBun();

const HOUR = 3_600_000;
const now = '2026-09-20T12:00:00.000Z';

type Logged = { event: string; fields: Record<string, unknown> };
const recorder = () => {
  const logged: Logged[] = [];
  const logger = {
    log: (event: string, fields: Record<string, unknown>) =>
      void logged.push({ event, fields }),
    child: () => logger,
  };
  return { logged, logger: logger as never };
};

describe('verification cleanup run', () => {
  test('purges with a cutoff 24 hours before now, in batches, until a short batch', async () => {
    const calls: Array<{ before: string; limit: number }> = [];
    const answers = [3, 3, 1];
    const { logged, logger } = recorder();
    const cleanup = createVerificationCleanup({
      purge: async (input) => {
        calls.push(input);
        return answers.shift() ?? 0;
      },
      clock: fixedClock(now),
      logger,
      batchSize: 3,
      maxBatches: 10,
    });
    const result = await cleanup.run();
    assert({
      given: 'a backlog of 7 expired rows and a batch size of 3',
      should:
        'delete only rows expired more than 24 hours ago, stop after the short batch and log counts only',
      actual: {
        result,
        calls,
        logged: logged.map(({ event, fields }) => [event, fields]),
      },
      expected: {
        result: { ok: true, deleted: 7, batches: 3 },
        calls: Array(3).fill({
          before: '2026-09-19T12:00:00.000Z',
          limit: 3,
        }),
        logged: [
          [
            'auth.cleanup.completed',
            {
              operation: 'auth.cleanup.verification',
              deleted: 7,
              batches: 3,
            },
          ],
        ],
      },
    });
  });

  test('a run is bounded by maxBatches even when rows keep arriving', async () => {
    let calls = 0;
    const { logger } = recorder();
    const cleanup = createVerificationCleanup({
      purge: async () => {
        calls += 1;
        return 2;
      },
      clock: fixedClock(now),
      logger,
      batchSize: 2,
      maxBatches: 4,
    });
    const result = await cleanup.run();
    assert({
      given: 'a table that always returns full batches',
      should: 'stop at the batch cap and report it',
      actual: { calls, result },
      expected: { calls: 4, result: { ok: true, deleted: 8, batches: 4 } },
    });
  });

  test('a failure logs a distinct error event with no payload and does not throw', async () => {
    const { logged, logger } = recorder();
    const cleanup = createVerificationCleanup({
      purge: async () => {
        throw new Error('insert into verification value user@example.test');
      },
      clock: fixedClock(now),
      logger,
    });
    const result = await cleanup.run();
    assert({
      given: 'a purge that throws an error containing SQL and an address',
      should:
        'report ok:false and log auth.cleanup.failed with only a stable code',
      actual: {
        result,
        logged: logged.map(({ event, fields }) => [event, fields]),
        leaked: JSON.stringify(logged).includes('example.test'),
      },
      expected: {
        result: { ok: false, deleted: 0, batches: 0 },
        logged: [
          [
            'auth.cleanup.failed',
            {
              operation: 'auth.cleanup.verification',
              errorCode: 'INFRASTRUCTURE',
            },
          ],
        ],
        leaked: false,
      },
    });
  });
});

describe('verification cleanup schedule', () => {
  const fakeTimers = () => {
    const state: { tick?: () => void; cleared: unknown[]; interval?: number } =
      { cleared: [] };
    return {
      state,
      timers: {
        setInterval: (tick: () => void, ms: number) => {
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
    state.tick?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    state.tick?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
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
    state.tick?.();
    state.tick?.();
    release();
    await Promise.resolve();
    assert({
      given: 'an hourly tick arriving during a long run',
      should: 'not start a second overlapping run in the same process',
      actual: started,
      expected: 1,
    });
  });
});
