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
const step = (id: string, phase = 'after-scrub'): PrivacyAdopter =>
  ({
    id,
    phase,
    erase: async () => {},
    export: async () => ({}),
  }) as PrivacyAdopter;
test('a duplicate or malformed adopter fails before executing', async () => {
  for (const adoption of [
    [step('messaging'), step('messaging')],
    [step(' ')],
    [step('messaging', 'whenever')],
  ])
    for (const actual of [
      () => planPrivacyExport(subject, adoption),
      () =>
        planPrivacyErasure({ subject, now, vendors: [], jobIds: [] }, adoption),
    ])
      await assertRejects({
        given: 'two steps with one id, a blank id or an unknown phase',
        should: 'refuse the privacy operation',
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
    [],
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
      actual: () => planPrivacyErasure({ ...base, ...change }, []),
      code: 'VALIDATION',
    });
});
