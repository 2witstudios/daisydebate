import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  advancePurchase,
  nextPurchaseWork,
} from './billing-purchase-lifecycle';
import {
  at,
  claimId,
  anotherClaim,
  base,
  context,
  changed,
  started,
} from './billing-purchase.test-support';
setupRitewayBun();
test('one admitted purchase has bounded creation authority and a durable possible-effect marker', () => {
  const purchase = started();
  assert({
    given:
      'first creation claim followed by a duplicate submit before lease expiry',
    should: 'persist possible vendor work and refuse a competing claimant',
    actual: [
      purchase.state,
      advancePurchase(
        purchase,
        { kind: 'claim', claimId: anotherClaim },
        context(2),
      ),
    ],
    expected: [
      {
        kind: 'creating',
        startedAt: at(1),
        claim: { id: claimId, claimedAt: at(1), expiresAt: at(31) },
      },
      { kind: 'refuse' },
    ],
  });
  assert({
    given: 'an admitted but never dispatched purchase at the creation cutoff',
    should: 'allow only proven abandonment without beginning vendor work',
    actual: [
      nextPurchaseWork(base, context(300)),
      advancePurchase(base, { kind: 'claim', claimId }, context(300)),
    ],
    expected: ['abandon', { kind: 'refuse' }],
  });
});

test('lost replies and expired claims recover the same identity only inside its original creation window', () => {
  const purchase = started();
  const recovered = changed(
    purchase,
    { kind: 'claim', claimId: anotherClaim },
    31,
  );
  assert({
    given: 'a claim recovered at its exact expiry',
    should:
      'retain first possible execution and refuse the old worker failure response',
    actual: [
      recovered.state,
      advancePurchase(recovered, { kind: 'unknown', claimId }, context(32)),
    ],
    expected: [
      {
        kind: 'creating',
        startedAt: at(1),
        claim: { id: anotherClaim, claimedAt: at(31), expiresAt: at(61) },
      },
      { kind: 'refuse' },
    ],
  });
  const unknown = changed(
    recovered,
    { kind: 'unknown', claimId: anotherClaim },
    32,
  );
  assert({
    given:
      'an unknown result before retry, at retry, after cutoff, and beyond vendor key retention',
    should:
      'wait, recover the same attempt, then discover without new creation or abandonment',
    actual: [
      nextPurchaseWork(unknown, context(36)),
      nextPurchaseWork(unknown, context(37)),
      nextPurchaseWork(unknown, context(300)),
      nextPurchaseWork(unknown, context(172800)),
      advancePurchase(unknown, { kind: 'abandon' }, context(172800)),
    ],
    expected: ['wait', 'create', 'discover', 'discover', { kind: 'refuse' }],
  });
});

test('a final-second claim cannot extend creation authority beyond the admitted cutoff', () => {
  const purchase = changed(base, { kind: 'claim', claimId }, 299);
  assert({
    given: 'one second remains in the five-minute admitted window',
    should: 'bound the claim to that cutoff and never renew it at the cutoff',
    actual: [
      purchase.state,
      nextPurchaseWork(purchase, context(300)),
      advancePurchase(
        purchase,
        { kind: 'claim', claimId: anotherClaim },
        context(300),
      ),
    ],
    expected: [
      {
        kind: 'creating',
        startedAt: at(299),
        claim: { id: claimId, claimedAt: at(299), expiresAt: at(300) },
      },
      'discover',
      { kind: 'refuse' },
    ],
  });
});
