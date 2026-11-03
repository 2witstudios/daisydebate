import { assert, setupRitewayBun, test } from 'riteway/bun';
import { runWorker } from './worker';

setupRitewayBun();

test('a database failure does not end the slot', async () => {
  let claims = 0;
  const reports: string[] = [];
  await runWorker({
    owner: 'w',
    now: () => 0,
    sleep: async () => {},
    stopped: () => claims >= 3,
    report: (event) => reports.push(event),
    objects: {} as never,
    store: {
      claim: async () => {
        claims += 1;
        if (claims < 3) throw new Error('database down');
        return null;
      },
    } as never,
  });
  assert({
    given: 'two failed claims and then an idle one',
    should: 'report each and keep going',
    actual: [claims, reports],
    expected: [3, ['broadcast.release_failed', 'broadcast.release_failed']],
  });
});
