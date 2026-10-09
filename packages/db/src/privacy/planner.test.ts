import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { planPrivacyErasure, planPrivacyExport } from './planner';
import type { PrivacyAdopter } from './contracts';

setupRitewayBun();
const subject = {
  userId: 'abcdefghijklmnopqrstuvwx',
  actorId: 'bcdefghijklmnopqrstuvwxy',
};
const now = '2026-10-09T18:00:00.000Z';
const config = {
  requiredAdopters: [
    { id: 'messaging', phase: 'before-auth' as const, expectedColumns: {} },
  ],
  adopters: [] as PrivacyAdopter[],
};
test('missing cleanup/export adoption fails before executing', async () => {
  for (const actual of [
    () => planPrivacyExport(subject, config),
    () => planPrivacyErasure({ subject, now, vendors: [], jobIds: [] }, config),
  ])
    await assertRejects({
      given: 'a configured messaging producer with no adopter',
      should: 'refuse a partial privacy operation',
      actual,
      code: 'VALIDATION',
    });
});
test('erasure plans only injected configured vendors', () => {
  const result = planPrivacyErasure(
    {
      subject,
      now,
      vendors: ['posthog'],
      jobIds: ['cdefghijklmnopqrstuvwxyz'],
    },
    { requiredAdopters: [], adopters: [] },
  );
  assert({
    given: 'one configured vendor, injected ID and time',
    should: 'plan one durable intent without ambient resources',
    actual: result,
    expected: {
      subject,
      now,
      adopterIds: [],
      jobs: [
        {
          id: 'cdefghijklmnopqrstuvwxyz',
          vendor: 'posthog',
          subjectRef: subject.userId,
          createdAt: now,
        },
      ],
    },
  });
});
test('invalid vendor IDs and times are refused', async () => {
  const base = {
    subject,
    now,
    vendors: ['posthog'],
    jobIds: ['cdefghijklmnopqrstuvwxyz'],
  };
  for (const change of [
    { now: 'bad' },
    { jobIds: [] },
    { vendors: ['unknown'] },
    {
      vendors: ['posthog', 'posthog'],
      jobIds: ['cdefghijklmnopqrstuvwxyz', 'defghijklmnopqrstuvwxyza'],
    },
  ])
    await assertRejects({
      given: 'invalid or duplicate erasure inputs',
      should: 'refuse before any local writes',
      actual: () =>
        planPrivacyErasure(
          { ...base, ...change },
          { requiredAdopters: [], adopters: [] },
        ),
      code: 'VALIDATION',
    });
});
