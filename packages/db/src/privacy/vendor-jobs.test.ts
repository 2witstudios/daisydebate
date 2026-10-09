import { assert, setupRitewayBun, test } from 'riteway/bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { deliverPrivacyJob } from './vendor-jobs';

setupRitewayBun();
const input = {
  jobId: 'abcdefghijklmnopqrstuvwx',
  vendor: 'posthog' as const,
  now: '2026-10-09T18:00:00.000Z',
  retryAt: '2026-10-09T18:01:00.000Z',
};
test('vendor failure stores retry without raw errors', async () => {
  const fake = fakeSql([[{ subjectRef: 'bcdefghijklmnopqrstuvwxy' }], []]);
  const result = await deliverPrivacyJob(
    drizzle({ client: fake.client }),
    input,
    {
      erase: async () => {
        throw new Error('private vendor payload');
      },
    },
  );
  assert({
    given:
      'a failing injected vendor transport after a committed job is loaded',
    should: 'leave a pending retry and keep raw error text out of SQL',
    actual: [
      result,
      fake.queries.length,
      JSON.stringify(fake.queries).includes('private vendor payload'),
    ],
    expected: ['retry', 2, false],
  });
});
test('missing or not-due configured vendor jobs make no external calls', async () => {
  const fake = fakeSql([[]]);
  let calls = 0;
  const result = await deliverPrivacyJob(
    drizzle({ client: fake.client }),
    input,
    {
      erase: async () => {
        calls++;
      },
    },
  );
  assert({
    given: 'no committed pending due job for the configured vendor',
    should: 'perform no vendor action',
    actual: [result, calls, fake.queries.length],
    expected: ['idle', 0, 1],
  });
});
