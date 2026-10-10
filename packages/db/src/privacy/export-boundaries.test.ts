import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { fakeSql } from '../index.test-support';
import { accountAgePrivacyAdopter } from '../account-age';
import { exportPrivacySubject } from './operations';
import { deliverPrivacyJob } from './vendor-jobs';
import type { PrivacyExport } from './contracts';

setupRitewayBun();
const subject = { userId: 'u'.repeat(24), actorId: 'a'.repeat(24) };
const account = { ...subject, member: true, erased: false, revision: 1 };
const input = {
  jobId: 'j'.repeat(24),
  vendor: 'posthog' as const,
  now: '2026-10-09T00:00:00.000Z',
  retryAt: '2026-10-09T00:01:00.000Z',
};

test('canonical export rejects undeclared tables, columns and non-JSON values', async () => {
  const invalid: unknown[] = [
    {},
    { account_age: [], extra: [] },
    { account_age: null },
    { account_age: [{ birth_month: new Date(input.now) }] },
    { account_age: [{ secret: 'not-exportable' }] },
  ];
  for (const result of invalid) {
    const fake = fakeSql([[account], []]);
    await assertRejects({
      given: 'an invalid injected adopter projection',
      should: 'reject before exposing personal data',
      code: 'VALIDATION',
      actual: () =>
        exportPrivacySubject(drizzle({ client: fake.client }), subject, {
          requiredAdopters: [
            {
              id: 'account-age',
              phase: 'after-scrub',
              expectedColumns: {
                account_age: [
                  'user_id',
                  'birth_month',
                  'version',
                  'recorded_at',
                ],
              },
            },
          ],
          adopters: [
            {
              ...accountAgePrivacyAdopter,
              export: async () => result as PrivacyExport,
            },
          ],
        }),
    });
  }
});

test('vendor success binds its due subject and acknowledges only its own pending job', async () => {
  const fake = fakeSql([[{ subjectRef: subject.userId }], []]);
  const called: string[] = [];
  const result = await deliverPrivacyJob(
    drizzle({ client: fake.client }),
    input,
    {
      erase: async (id) => {
        called.push(id);
      },
    },
  );
  assert({
    given: 'a committed due job and successful idempotent vendor deletion',
    should: 'acknowledge only the selected subject/job/vendor after deletion',
    actual: [
      result,
      called,
      fake.queries[1]?.query.includes("status = 'succeeded'"),
      fake.queries[1]?.params.includes(input.jobId),
      fake.queries[1]?.params.includes(input.vendor),
    ],
    expected: ['succeeded', [subject.userId], true, true, true],
  });
});

test('invalid job clock/binding refuses before vendor activity', async () => {
  for (const patch of [
    { jobId: 'invalid' },
    { now: 'invalid' },
    { retryAt: input.now },
    { now: '2026-10-09' },
  ]) {
    const fake = fakeSql([]);
    await assertRejects({
      given: 'invalid job identity or deadline',
      should: 'perform neither SQL nor vendor deletion',
      code: 'VALIDATION',
      actual: () =>
        deliverPrivacyJob(
          drizzle({ client: fake.client }),
          { ...input, ...patch },
          {
            erase: async () => {
              throw new Error('Vendor must not run');
            },
          },
        ),
    });
    assert({
      given: 'a rejected job',
      should: 'perform no SQL',
      actual: fake.queries.length,
      expected: 0,
    });
  }
  const fake = fakeSql([[{ subjectRef: 'invalid' }]]);
  await assertRejects({
    given: 'a malformed persisted job subject',
    should: 'reject before calling its vendor',
    code: 'VALIDATION',
    actual: () =>
      deliverPrivacyJob(drizzle({ client: fake.client }), input, {
        erase: async () => {
          throw new Error('Vendor must not run');
        },
      }),
  });
});
