import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createNotificationSweep } from './sweep';

setupRitewayBun();

describe('the notification sweep', () => {
  test('reads the release rule at this instant', async () => {
    const calls: unknown[] = [];
    await createNotificationSweep({
      store: {
        sweepNotificationFanouts: async (input: {
          clock: { now: string; rankedDelaySeconds: number };
          limit: number;
        }) => {
          calls.push(input.clock.now, input.limit > 0);
          return 0;
        },
      } as never,
      now: () => '2026-11-02T00:00:00.000Z',
      nextId: () => 'id',
    })();
    assert({
      given: 'one pass',
      should: 'sweep a bounded batch by the injected clock',
      actual: calls,
      expected: ['2026-11-02T00:00:00.000Z', true],
    });
  });
});
