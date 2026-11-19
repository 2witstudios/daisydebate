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
test('missing policy account rejects before any source read', async () => {
  let calls = 0;
  await assertRejects({
    given: 'a missing account among the locked projection',
    should: 'fail before source I/O',
    actual: () =>
      loadAccountPolicyFacts({
        accounts: [adultAccount('a').account, null],
        now: '2026-10-09T00:00:00.000Z',
        readAgeFact: async () => {
          calls++;
          return { state: 'unknown' };
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
test('contact facts ride on the accounts they describe', async () => {
  const a = adultAccount('a');
  const b = adultAccount('b');
  const contact = (friend: string) => ({
    requestSetting: 'friends' as const,
    friendActorIds: [friend],
    linkedAdultUserIds: [],
  });
  const seen: unknown[] = [];
  const facts = await loadAccountPolicyFacts({
    accounts: [a.account, b.account],
    now: '2026-10-09T00:00:00.000Z',
    readAgeFact: async (account) => (account.actorId === 'a' ? a.age : b.age),
    readContactFacts: async (rows) => {
      seen.push(rows.map((row) => row.age));
      return [contact('b'), contact('a')];
    },
  });
  assert({
    given: 'a contact reader beside the age reader',
    should: 'read it after the ages and attach each fact to its own account',
    actual: { seen, facts },
    expected: {
      seen: [[a.age, b.age]],
      facts: [
        { account: a.account, age: a.age, contact: contact('b') },
        { account: b.account, age: b.age, contact: contact('a') },
      ],
    },
  });
});
test('a contact reader that loses an account is an outage', async () =>
  assertRejects({
    given: 'a contact reader returning fewer facts than accounts',
    should: 'fail as infrastructure, never pair facts with the wrong account',
    actual: () =>
      loadAccountPolicyFacts({
        accounts: [adultAccount('a').account],
        now: '2026-10-09T00:00:00.000Z',
        readAgeFact: async () => adultAccount('a').age,
        readContactFacts: async () => [],
      }),
    code: 'INFRASTRUCTURE',
  }));
