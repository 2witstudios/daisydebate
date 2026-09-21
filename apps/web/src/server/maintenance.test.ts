import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import { startMaintenance } from './maintenance';

setupRitewayBun();

describe('server maintenance', () => {
  test('an hourly tick purges verification rows expired before the 24-hour grace, and stop clears the timer', async () => {
    const purged: Array<{ before: string; limit: number }> = [];
    const handles: string[] = [];
    let tick: () => void = () => undefined;
    const logger = { log: () => undefined, child: () => logger } as never;
    const maintenance = startMaintenance({
      database: {
        purgeExpiredVerifications: async (input) => {
          purged.push(input);
          return 0;
        },
      },
      clock: fixedClock('2026-09-20T12:00:00.000Z'),
      logger,
      timers: {
        setInterval: (fn) => {
          tick = fn;
          return 'timer';
        },
        clearInterval: (handle) => void handles.push(String(handle)),
      },
    });
    tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    maintenance.stop();
    assert({
      given: 'the production maintenance composition and one hourly tick',
      should:
        'purge with a cutoff 24 hours before now in bounded batches and clear its timer on stop',
      actual: { purged, handles },
      expected: {
        purged: [{ before: '2026-09-19T12:00:00.000Z', limit: 500 }],
        handles: ['timer'],
      },
    });
  });
});
