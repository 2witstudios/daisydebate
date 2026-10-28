import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import type { ContactsPolicyOverride } from '@daisy/config';
import { dec251ContactsPolicy, tightenContactsPolicy } from './request-policy';

setupRitewayBun();

test('the shipped Contacts policy carries DEC-251’s social request budget, frozen', () => {
  assert({
    given: 'the composed Contacts policy',
    should:
      'count 20 a day, 5 an hour to unrelated accounts, and block for 30 days after 3 declines',
    actual: [
      dec251ContactsPolicy.requests,
      Object.isFrozen(dec251ContactsPolicy.requests),
    ],
    expected: [
      {
        daily: 20,
        unrelatedHourly: 5,
        declinesToBlock: 3,
        declineBlockMs: 2_592_000_000,
      },
      true,
    ],
  });
});

test('blocking spends Contacts’ own budget, the DEC-251 send windows', () => {
  assert({
    given: 'the composed Contacts policy',
    should: 'allow 10 contact changes in 10 s, 30 a minute and 600 an hour',
    actual: dec251ContactsPolicy.blocks,
    expected: [
      { max: 10, windowSeconds: 10 },
      { max: 30, windowSeconds: 60 },
      { max: 600, windowSeconds: 3_600 },
    ],
  });
});

test('a CONTACTS_POLICY override may only tighten DEC-251', async () => {
  const tightened = tightenContactsPolicy(dec251ContactsPolicy, {
    requests: { daily: 10, declineBlockMs: 3_000_000_000 },
  });
  assert({
    given: 'no override, then tighter values',
    should: 'keep the shipped policy as is, then apply each value to its field',
    actual: [
      tightenContactsPolicy(dec251ContactsPolicy, undefined) ===
        dec251ContactsPolicy,
      tightened.requests,
    ],
    expected: [
      true,
      {
        daily: 10,
        unrelatedHourly: 5,
        declinesToBlock: 3,
        declineBlockMs: 3_000_000_000,
      },
    ],
  });
  for (const [given, override] of [
    ['more daily requests', { requests: { daily: 21 } }],
    ['more unrelated requests an hour', { requests: { unrelatedHourly: 6 } }],
    ['more declines before a block', { requests: { declinesToBlock: 4 } }],
    ['a shorter decline block', { requests: { declineBlockMs: 1 } }],
  ] satisfies [string, ContactsPolicyOverride][])
    await assertRejects({
      given,
      should: 'refuse the whole policy at boot rather than clamp it',
      actual: async () => tightenContactsPolicy(dec251ContactsPolicy, override),
      code: 'VALIDATION',
    });
});
