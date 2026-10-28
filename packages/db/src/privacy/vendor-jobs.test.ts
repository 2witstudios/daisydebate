import { assert, setupRitewayBun, test } from 'riteway/bun';
import { rejectionOf } from '@daisy/errors/testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { deliverPrivacyJob, duePrivacyJobs } from './vendor-jobs';

setupRitewayBun();
const input = {
  jobId: 'abcdefghijklmnopqrstuvwx',
  vendor: 'posthog' as const,
  now: '2026-10-09T18:00:00.000Z',
  retryAt: '2026-10-09T18:01:00.000Z',
};
test('due jobs are read oldest-first within the limit', async () => {
  const fake = fakeSql([
    [
      { id: 'abcdefghijklmnopqrstuvwx', vendor: 'posthog', attempts: 0 },
      { id: 'bcdefghijklmnopqrstuvwxy', vendor: 'beehiiv', attempts: 3 },
    ],
  ]);
  const due = await duePrivacyJobs(drizzle({ client: fake.client }), {
    now: '2026-10-09T18:00:00.000Z',
    limit: 16,
  });
  assert({
    given: 'two committed due pending jobs',
    should: 'return them in the read order with their vendors and attempts',
    actual: due.map((job) => [job.id, job.vendor, job.attempts]),
    expected: [
      ['abcdefghijklmnopqrstuvwx', 'posthog', 0],
      ['bcdefghijklmnopqrstuvwxy', 'beehiiv', 3],
    ],
  });
  assert({
    given: 'the due-jobs read',
    should: 'select only pending jobs due at or before now, bounded',
    actual: [
      fake.queries[0]?.query.includes("status = 'pending'"),
      fake.queries[0]?.query.includes('retry_at <='),
      fake.queries[0]?.query.includes('limit'),
    ],
    expected: [true, true, true],
  });
});
test('malformed due-jobs reads are refused', async () => {
  const fake = fakeSql([[]]);
  const database = drizzle({ client: fake.client });
  assert({
    given: 'a non-instant now or an unsafe limit',
    should: 'refuse the read as VALIDATION before any query',
    actual: await Promise.all([
      rejectionOf(() =>
        duePrivacyJobs(database, { now: 'not-a-date', limit: 16 }),
      ).then(({ code }) => code),
      rejectionOf(() =>
        duePrivacyJobs(database, { now: input.now, limit: 0 }),
      ).then(({ code }) => code),
      rejectionOf(() =>
        duePrivacyJobs(database, { now: input.now, limit: 1_000 }),
      ).then(({ code }) => code),
    ]),
    expected: ['VALIDATION', 'VALIDATION', 'VALIDATION'],
  });
  assert({
    given: 'a refused read',
    should: 'run no query',
    actual: fake.queries.length,
    expected: 0,
  });
});
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
