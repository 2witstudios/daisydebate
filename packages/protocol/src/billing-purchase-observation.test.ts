import { assert, setupRitewayBun, test } from 'riteway/bun';
import { purchaseSchema } from './billing-purchase';
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
  observed,
} from './billing-purchase.test-support';
setupRitewayBun();
test('verified late session discovery survives lease expiry and account closure without authorizing payment or access', () => {
  const purchase = started();
  const result = advancePurchase(
    purchase,
    {
      kind: 'observe',
      session: {
        kind: 'complete',
        id: 'cs_test_owned',
        customerId: 'cus_owned',
        subscriptionId: 'sub_owned',
      },
    },
    context(400, 'closed'),
  );
  if (result.kind !== 'changed') throw Error('Expected late discovery');
  const complete = { ...purchase, state: result.state };
  assert({
    given: 'a verified completed session discovered after the local closure',
    should:
      'retain exact vendor identities solely for cleanup and refuse a new creation claim',
    actual: [
      result.state,
      nextPurchaseWork(complete, context(401, 'closed')),
      advancePurchase(
        complete,
        { kind: 'claim', claimId: anotherClaim },
        context(401, 'closed'),
      ),
    ],
    expected: [
      {
        kind: 'complete',
        startedAt: at(1),
        sessionId: 'cs_test_owned',
        customerId: 'cus_owned',
        subscriptionId: 'sub_owned',
      },
      'cleanup',
      { kind: 'refuse' },
    ],
  });
  assert({
    given: 'the same completed session for an active account',
    should:
      'request separate payment reconciliation, never report a paid entitlement',
    actual: nextPurchaseWork(complete, context(401)),
    expected: 'synchronize',
  });
});

test('session identity and terminal outcomes cannot regress under reversed vendor responses', () => {
  const open = observed(started(), 'open', 2);
  const complete = changed(
    open,
    {
      kind: 'observe',
      session: {
        kind: 'complete',
        id: 'cs_test_owned',
        customerId: 'cus_owned',
        subscriptionId: 'sub_owned',
      },
    },
    3,
  );
  assert({
    given:
      'a stale open response, different session, contradictory terminal response, or changed subscription',
    should:
      'ignore only the stale same-session open response and refuse all identity changes',
    actual: [
      advancePurchase(
        complete,
        {
          kind: 'observe',
          session: { kind: 'open', id: 'cs_test_owned', customerId: null },
        },
        context(4),
      ),
      advancePurchase(
        open,
        {
          kind: 'observe',
          session: { kind: 'open', id: 'cs_test_other', customerId: null },
        },
        context(4),
      ),
      advancePurchase(
        complete,
        {
          kind: 'observe',
          session: { kind: 'expired', id: 'cs_test_owned', customerId: null },
        },
        context(4),
      ),
      advancePurchase(
        complete,
        {
          kind: 'observe',
          session: {
            kind: 'complete',
            id: 'cs_test_owned',
            customerId: 'cus_owned',
            subscriptionId: 'sub_other',
          },
        },
        context(4),
      ),
    ],
    expected: [
      { kind: 'unchanged' },
      { kind: 'refuse' },
      { kind: 'refuse' },
      { kind: 'refuse' },
    ],
  });
});

test('a one-hour session deadline requests expiration but elapsed time alone never proves expiration', () => {
  const open = observed(started(), 'open', 2);
  assert({
    given:
      'an open session just before, at and long after the Checkout deadline',
    should:
      'retrieve before expiry and require vendor expiration afterward without releasing identity',
    actual: [
      nextPurchaseWork(open, context(3599)),
      nextPurchaseWork(open, context(3600)),
      nextPurchaseWork(open, context(172800)),
      advancePurchase(open, { kind: 'abandon' }, context(172800)),
    ],
    expected: ['retrieve', 'expire', 'expire', { kind: 'refuse' }],
  });
  const expired = observed(open, 'expired', 3601);
  assert({
    given: 'positive same-session expiration followed by an old open response',
    should:
      'remain terminal without permitting old creation authority to run again',
    actual: [
      nextPurchaseWork(expired, context(3602)),
      advancePurchase(
        expired,
        {
          kind: 'observe',
          session: { kind: 'open', id: 'cs_test_owned', customerId: null },
        },
        context(3602),
      ),
      advancePurchase(
        expired,
        { kind: 'claim', claimId: anotherClaim },
        context(3602),
      ),
    ],
    expected: ['none', { kind: 'unchanged' }, { kind: 'refuse' }],
  });
});

test('closure abandons only a proven undispatched identity and never erases possible side effects', () => {
  const abandoned = advancePurchase(
    base,
    { kind: 'abandon' },
    context(1, 'closed'),
  );
  assert({
    given: 'local closure before or after the durable creation marker',
    should:
      'abandon only the former and retain discovery/cleanup for the latter',
    actual: [
      abandoned,
      nextPurchaseWork(started(), context(2, 'closed')),
      advancePurchase(started(), { kind: 'abandon' }, context(2, 'closed')),
    ],
    expected: [
      { kind: 'changed', state: { kind: 'abandoned', abandonedAt: at(1) } },
      'cleanup',
      { kind: 'refuse' },
    ],
  });
  if (abandoned.kind !== 'changed') throw Error('Expected abandonment');
  assert({
    given: 'a replay of an abandoned identity',
    should: 'refuse both creation and fabricated late vendor discovery',
    actual: [
      advancePurchase(
        { ...base, state: abandoned.state },
        { kind: 'claim', claimId },
        context(2),
      ),
      advancePurchase(
        { ...base, state: abandoned.state },
        {
          kind: 'observe',
          session: { kind: 'open', id: 'cs_test_owned', customerId: null },
        },
        context(2),
      ),
    ],
    expected: [{ kind: 'refuse' }, { kind: 'refuse' }],
  });
});

test('current authority, frozen customer mapping, strict shape and coherent clocks constrain every transition', () => {
  const purchase = started();
  const mapped = { ...purchase, customerId: 'cus_existing' };
  assert({
    given:
      'no current authority, backwards time or a mismatched preexisting customer',
    should: 'refuse without altering any purchase state',
    actual: [
      advancePurchase(base, { kind: 'claim', claimId }, context(1, 'denied')),
      advancePurchase(purchase, { kind: 'unknown', claimId }, context(0)),
      advancePurchase(
        mapped,
        {
          kind: 'observe',
          session: {
            kind: 'complete',
            id: 'cs_test_owned',
            customerId: 'cus_other',
            subscriptionId: 'sub_owned',
          },
        },
        context(2),
      ),
    ],
    expected: [{ kind: 'refuse' }, { kind: 'refuse' }, { kind: 'refuse' }],
  });
  assert({
    given:
      'extra fields, non-UTC precision, a future-first marker, wrong mode or unsafe return origin',
    should: 'reject malformed serialized purchases instead of repairing them',
    actual: [
      purchaseSchema.safeParse({ ...base, paid: true }).success,
      purchaseSchema.safeParse({ ...base, admittedAt: '2026-11-05T00:00:00Z' })
        .success,
      purchaseSchema.safeParse({ ...purchase, admittedAt: at(2) }).success,
      purchaseSchema.safeParse({
        ...observed(purchase, 'open', 2),
        mode: 'live',
      }).success,
      purchaseSchema.safeParse({
        ...base,
        returnOrigin: 'https://user:secret@daisy.example',
      }).success,
      purchaseSchema.safeParse({
        ...base,
        returnOrigin: 'https://daisy.example/path?next=attacker',
      }).success,
      purchaseSchema.safeParse({ ...base, returnOrigin: 'not-a-url' }).success,
    ],
    expected: [false, false, false, false, false, false, false],
  });
});
