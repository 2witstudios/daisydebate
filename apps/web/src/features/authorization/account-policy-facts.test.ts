import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { AuthorizationTransaction } from '@daisy/db/authorization';
import { loadAccountPolicyFacts } from './account-policy-facts';
setupRitewayBun();
test('web policy composition reads the minimal age and contact facts in its caller transaction', async () => {
  const account = {
    userId: 'a'.repeat(24),
    actorId: 'b'.repeat(24),
    member: true,
    beta: { state: 'approved' as const, revision: 1 },
    ageBand: 'adult' as const,
    restricted: false,
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
  const contact = {
    user_id: account.userId,
    setting: 'friends',
    protection: { level: 'independent' },
    friend_actor_ids: ['c'.repeat(24)],
    linked_adult_user_ids: [],
  };
  const tx = {
    execute: async () => {
      reads++;
      return reads === 1 ? [age] : [contact];
    },
  } as unknown as AuthorizationTransaction;
  const now = '2026-10-09T00:00:00.000Z';
  const facts = await loadAccountPolicyFacts(tx, [account], now);
  assert({
    given: 'current fenced account facts for an adult',
    should:
      'read the age, then its contact facts in one statement, on the same transaction',
    actual: { facts, reads },
    expected: {
      facts: [
        {
          account,
          age,
          contact: {
            requestSetting: 'friends',
            protectedMessageRequests: null,
            friendActorIds: ['c'.repeat(24)],
            linkedAdultUserIds: [],
          },
        },
      ],
      reads: 2,
    },
  });
});
