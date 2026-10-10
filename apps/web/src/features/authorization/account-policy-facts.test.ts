import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { AuthorizationTransaction } from '@daisy/db/authorization';
import { loadAccountPolicyFacts } from './account-policy-facts';
setupRitewayBun();
test('web policy composition reads only canonical minimal age facts in its caller transaction', async () => {
  const account = {
    userId: 'a'.repeat(24),
    actorId: 'b'.repeat(24),
    member: true,
    erased: false,
    revision: 1,
  };
  const age = {
    state: 'known' as const,
    actorId: account.actorId,
    band: 'adult' as const,
    revision: 2,
    accountRevision: 1,
    validUntil: '2026-11-01T00:00:00.000Z',
  };
  let reads = 0;
  const tx = {
    execute: async () => {
      reads++;
      return [age];
    },
  } as unknown as AuthorizationTransaction;
  const now = '2026-10-09T00:00:00.000Z';
  const facts = await loadAccountPolicyFacts(tx, [account], now);
  assert({
    given: 'current fenced account facts',
    should: 'use the sole minimal age producer without reading birthmonth',
    actual: { facts, reads },
    expected: { facts: [{ account, age }], reads: 1 },
  });
});
