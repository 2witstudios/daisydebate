import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { loadAccountPolicyFacts } from './account-policy-facts';
import { adultAccount } from './social.test-support';
setupRitewayBun();
test('minimal policy reader consumes a fenced age fact without birth data', async () => {
  const { account, age } = adultAccount('a');
  const reads: unknown[] = [];
  const facts = await loadAccountPolicyFacts({
    accounts: [account],
    now: '2026-10-09T00:00:00.000Z',
    readAgeFact: async (binding) => {
      reads.push(binding);
      return age;
    },
  });
  assert({
    given: 'a canonical minimal age reader bound to the same transaction',
    should: 'pass the exact account binding without requesting birth source',
    actual: { reads, facts },
    expected: { reads: [account], facts: [{ account, age }] },
  });
});
test('minimal policy facts use injected account-bound source without exposing birth data', async () => {
  const account = adultAccount('a').account;
  const reads: string[] = [];
  const facts = await loadAccountPolicyFacts({
    accounts: [account],
    now: '2026-10-09T00:00:00.000Z',
    readAgeSource: async (userId) => {
      reads.push(userId);
      return {
        birthMonth: '2000-01',
        revision: 1,
        recordedAt: '2026-10-01T00:00:00.000Z',
      };
    },
  });
  assert({
    given: 'a locked account and injected source reader',
    should: 'read only its user binding and emit minimal revision-bound age',
    actual: { reads, facts },
    expected: {
      reads: ['a'],
      facts: [
        {
          account,
          age: {
            state: 'known',
            actorId: 'a',
            band: 'adult',
            revision: 1,
            accountRevision: 1,
            validUntil: '2026-11-01T00:00:00.000Z',
          },
        },
      ],
    },
  });
});
test('missing policy account rejects before any source read', async () => {
  let calls = 0;
  await assertRejects({
    given: 'a missing account among the locked projection',
    should: 'fail before source I/O',
    actual: () =>
      loadAccountPolicyFacts({
        accounts: [adultAccount('a').account, null],
        now: '2026-10-09T00:00:00.000Z',
        readAgeSource: async () => {
          calls++;
          return null;
        },
      }),
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'the refusal',
    should: 'leave the source untouched',
    actual: calls,
    expected: 0,
  });
});
