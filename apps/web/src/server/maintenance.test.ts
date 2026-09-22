import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import { startMaintenance } from './maintenance';

setupRitewayBun();

describe('server maintenance', () => {
  test('the start-up run and one hourly tick purge verification and outbox rows expired before their grace windows, and stop clears both timers', async () => {
    const purgedVerifications: Array<{ before: string; limit: number }> = [];
    const purgedOutbox: Array<{ before: string; limit: number }> = [];
    const handles: string[] = [];
    const ticks: Array<() => unknown> = [];
    let handleCount = 0;
    const logger = { log: () => undefined, child: () => logger } as never;
    const maintenance = startMaintenance({
      database: {
        purgeExpiredVerifications: async (input) => {
          purgedVerifications.push(input);
          return 0;
        },
        purgeExpiredOutboxEvents: async (input) => {
          purgedOutbox.push(input);
          return 0;
        },
      },
      clock: fixedClock('2026-09-20T12:00:00.000Z'),
      logger,
      timers: {
        setInterval: (fn) => {
          handleCount += 1;
          ticks.push(fn);
          return `timer-${handleCount}`;
        },
        clearInterval: (handle) => void handles.push(String(handle)),
      },
    });
    await maintenance.initial;
    await Promise.all(ticks.map((tick) => tick()));
    await maintenance.stop();
    assert({
      given:
        'the production maintenance composition, its start-up run and one hourly tick of each timer',
      should:
        'purge verifications with a 24h cutoff, outbox rows with a 24h cutoff, in bounded batches, and clear both timers on stop',
      actual: { purgedVerifications, purgedOutbox, handles: handles.sort() },
      expected: {
        purgedVerifications: Array(2).fill({
          before: '2026-09-19T12:00:00.000Z',
          limit: 500,
        }),
        purgedOutbox: Array(2).fill({
          before: '2026-09-19T12:00:00.000Z',
          limit: 200,
        }),
        handles: ['timer-1', 'timer-2'],
      },
    });
  });
});
