import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { AccountAuthorizationFact } from './authorization-facts';
import {
  canManageBilling,
  canPurchasePremium,
  holdsGrantedPremium,
} from './billing-policy';
setupRitewayBun();
const member: AccountAuthorizationFact = {
  userId: 'u'.repeat(24),
  actorId: 'a'.repeat(24),
  member: true,
  erased: false,
  revision: 1,
  beta: { state: 'approved', revision: 1 },
  ageBand: 'adult',
  restricted: false,
};

test('purchasing Premium requires current participant admission while billing management remains an exit', () => {
  const accounts: (AccountAuthorizationFact | null)[] = [
    member,
    { ...member, ageBand: '16-17' },
    { ...member, restricted: true },
    { ...member, beta: null },
    { ...member, ageBand: null },
    { ...member, erased: true },
    { ...member, member: false },
    { ...member, actorId: null },
    null,
  ];
  assert({
    given:
      'admitted adult/teen, suspended, revoked, missing-age, erased, unbound and anonymous account facts',
    should:
      'admit purchases only under existing participant policy, preserve own cancellation for current members, and refuse erased or anonymous authority',
    actual: accounts.map((account) => [
      canPurchasePremium(account),
      canManageBilling(account),
    ]),
    expected: [
      [true, true],
      [true, true],
      [false, true],
      [false, true],
      [false, true],
      [false, false],
      [false, false],
      [false, false],
      [false, false],
    ],
  });
});

test('a current beta grant of AI Rounds is Premium for display, only while beta grants Premium', () => {
  const now = '2026-11-18T00:00:00.000Z';
  const beta = [{ entitlement: 'ai_rounds' as const, source: 'beta' as const }];
  assert({
    given: 'a beta AI Rounds grant with beta Premium on and off, and no grant',
    should: 'read as granted Premium only while beta grants Premium',
    actual: [
      holdsGrantedPremium(beta, { now, betaGrantsPremium: true }),
      holdsGrantedPremium(beta, { now, betaGrantsPremium: false }),
      holdsGrantedPremium([], { now, betaGrantsPremium: true }),
    ],
    expected: [true, false, false],
  });
});
