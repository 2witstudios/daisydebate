import { RANKED_DELAY_SECONDS } from '@daisy/debate-engine';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createFactLogSweep } from './fact-log-sweep';

setupRitewayBun();

test('each pass asks the store at the injected instant', async () => {
  const seen: unknown[] = [];
  const sweep = createFactLogSweep({
    store: {
      sweepSpectatorFactLog: async (input) => {
        seen.push(input);
        return 3;
      },
    },
    now: () => '2026-11-03T00:00:00.000Z',
  });
  assert({
    given: 'a pass of the log',
    should: 'record at this instant under the one ranked delay',
    actual: [await sweep(), seen],
    expected: [
      3,
      [
        {
          clock: {
            now: '2026-11-03T00:00:00.000Z',
            rankedDelaySeconds: RANKED_DELAY_SECONDS,
          },
          limit: 256,
        },
      ],
    ],
  });
});
