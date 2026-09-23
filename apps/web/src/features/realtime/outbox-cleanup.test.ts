import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import { createOutboxCleanup, startOutboxCleanup } from './outbox-cleanup';

setupRitewayBun();

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

describe('outbox cleanup run', () => {
  test('purges with a cutoff 24 hours before now, in batches, until a short batch', async () => {
    const calls: Array<{ before: string; limit: number }> = [];
    const answers = [3, 3, 1];
    const { logged, logger } = recorder();
    const cleanup = createOutboxCleanup({
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
      given:
        'a backlog of 7 delivered rows older than retention and a batch size of 3',
      should:
        'delete only rows older than 24 hours, stop after the short batch and log counts only',
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
            'realtime.cleanup.completed',
            {
              operation: 'realtime.cleanup.outbox',
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
    const cleanup = createOutboxCleanup({
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
    const cleanup = createOutboxCleanup({
      purge: async () => {
        throw new Error('delete from outbox where topic = debate:secret-id');
      },
      clock: fixedClock(now),
      logger,
    });
    const result = await cleanup.run();
    assert({
      given: 'a purge that throws an error containing a topic',
      should:
        'report ok:false and log realtime.cleanup.failed with only a stable code',
      actual: {
        result,
        logged: logged.map(({ event, fields }) => [event, fields]),
        leaked: JSON.stringify(logged).includes('secret-id'),
      },
      expected: {
        result: { ok: false, deleted: 0, batches: 0 },
        logged: [
          [
            'realtime.cleanup.failed',
            {
              operation: 'realtime.cleanup.outbox',
              errorCode: 'INFRASTRUCTURE',
            },
          ],
        ],
        leaked: false,
      },
    });
  });

  test('a failure after some batches still reports the rows already deleted', async () => {
    const answers: Array<number | Error> = [3, new Error('driver down')];
    const { logger } = recorder();
    const cleanup = createOutboxCleanup({
      purge: async () => {
        const next = answers.shift() ?? 0;
        if (next instanceof Error) throw next;
        return next;
      },
      clock: fixedClock(now),
      logger,
      batchSize: 3,
    });
    assert({
      given: 'a purge that deletes one full batch and then fails',
      should: 'report ok:false with the one batch and three rows that did go',
      actual: await cleanup.run(),
      expected: { ok: false, deleted: 3, batches: 1 },
    });
  });

  test('stop ends the run between batches without failing', async () => {
    let calls = 0;
    const { logged, logger } = recorder();
    const cleanup = createOutboxCleanup({
      purge: async () => {
        calls += 1;
        cleanup.stop();
        return 3;
      },
      clock: fixedClock(now),
      logger,
      batchSize: 3,
      maxBatches: 10,
    });
    const result = await cleanup.run();
    assert({
      given: 'a stop requested while the first full batch is being deleted',
      should:
        'finish that batch, start no more, and complete normally with its counts',
      actual: {
        calls,
        result,
        events: logged.map(({ event }) => event),
      },
      expected: {
        calls: 1,
        result: { ok: true, deleted: 3, batches: 1 },
        events: ['realtime.cleanup.completed'],
      },
    });
  });

  test('an unusable clock value is a failed run, never a throw', async () => {
    const { logged, logger } = recorder();
    const cleanup = createOutboxCleanup({
      purge: async () => 0,
      clock: { now: () => 'not a timestamp' },
      logger,
    });
    assert({
      given: 'a clock that returns an unparsable timestamp',
      should:
        'report ok:false and log realtime.cleanup.failed instead of throwing',
      actual: {
        result: await cleanup.run(),
        events: logged.map(({ event }) => event),
      },
      expected: {
        result: { ok: false, deleted: 0, batches: 0 },
        events: ['realtime.cleanup.failed'],
      },
    });
  });
});

describe('outbox cleanup schedule', () => {
  test('runs on start when asked, reschedules hourly, skips an overlapping tick, and stop clears the timer', async () => {
    let inFlight: { resolve: () => void } | undefined;
    let runs = 0;
    const cleanup = {
      run: () =>
        new Promise<{ ok: true; deleted: number; batches: number }>(
          (resolve) => {
            runs += 1;
            inFlight = {
              resolve: () => resolve({ ok: true, deleted: 0, batches: 0 }),
            };
          },
        ),
      stop: () => undefined,
    };
    let tick: () => unknown = () => undefined;
    let intervalMs = 0;
    const handles: string[] = [];
    const schedule = startOutboxCleanup({
      cleanup,
      timers: {
        setInterval: (fn, ms) => {
          tick = fn;
          intervalMs = ms;
          return 'outbox-timer';
        },
        clearInterval: (handle) => void handles.push(String(handle)),
      },
      runOnStart: true,
    });
    // A tick that arrives while the start-up run is still in flight is a no-op.
    tick();
    tick();
    const overlapped = runs;
    inFlight?.resolve();
    await schedule.initial;
    await schedule.stop();
    assert({
      given: 'runOnStart, an hourly interval, and a tick while still running',
      should:
        'run once on start, run hourly, skip the overlapping tick, and clear the timer on stop',
      actual: { runs: overlapped, intervalMs, handles },
      expected: { runs: 1, intervalMs: 3_600_000, handles: ['outbox-timer'] },
    });
  });
});
