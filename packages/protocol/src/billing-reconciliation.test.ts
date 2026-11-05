import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { SubscriptionEvidence } from './billing';
import { reconcileSubscriptionEvidence } from './billing-reconciliation';
setupRitewayBun();
const paid: SubscriptionEvidence = {
  lifecycle: 'active',
  settlement: {
    kind: 'paid',
    invoiceId: 'in_original',
    period: {
      subscriptionId: 'a'.repeat(24),
      startsAt: '2026-11-01T00:00:00.000Z',
      endsAt: '2026-12-01T00:00:00.000Z',
    },
  },
};
const renewal: SubscriptionEvidence = {
  lifecycle: 'active',
  settlement: {
    kind: 'paid',
    invoiceId: 'in_renewal',
    period: {
      subscriptionId: 'a'.repeat(24),
      startsAt: '2026-12-01T00:00:00.000Z',
      endsAt: '2027-01-01T00:00:00.000Z',
    },
  },
};
const failed: SubscriptionEvidence = {
  lifecycle: 'past_due',
  settlement: {
    kind: 'renewal_failed',
    invoiceId: 'in_renewal',
    period:
      renewal.settlement.kind === 'paid' ? renewal.settlement.period : never(),
    previous:
      paid.settlement.kind === 'paid'
        ? {
            invoiceId: paid.settlement.invoiceId,
            period: paid.settlement.period,
          }
        : never(),
  },
};
function never(): never {
  throw Error('Invalid fixture');
}

test('a canceled or incomplete-expired vendor identity cannot resurrect from a later stale response', () => {
  assert({
    given: 'stored terminal identities and an active paid response',
    should: 'retain terminal lifecycle while preserving verified paid history',
    actual: (['canceled', 'incomplete_expired'] as const).map((lifecycle) =>
      reconcileSubscriptionEvidence({ ...paid, lifecycle }, renewal),
    ),
    expected: (['canceled', 'incomplete_expired'] as const).map(
      (lifecycle) => ({ ...renewal, lifecycle }),
    ),
  });
});
test('reversed invoice reads cannot replace a newer paid period with older or missing payment', () => {
  assert({
    given:
      'verified renewal followed by old payment, failed renewal, and absent payment evidence',
    should: 'retain the latest paid period, never regress to grace or unpaid',
    actual: [
      paid,
      failed,
      {
        lifecycle: 'active',
        settlement: { kind: 'unpaid' },
      } as SubscriptionEvidence,
    ].map((next) => reconcileSubscriptionEvidence(renewal, next)),
    expected: [renewal, { ...renewal, lifecycle: 'past_due' }, renewal],
  });
});
test('a renewed payment resolves failed renewal without carrying earlier free or subscription periods', () => {
  assert({
    given: 'failed renewal then verified payment of that same invoice',
    should: 'advance exactly once to the paid period and repeat idempotently',
    actual: [
      reconcileSubscriptionEvidence(paid, failed),
      reconcileSubscriptionEvidence(failed, renewal),
      reconcileSubscriptionEvidence(renewal, renewal),
    ],
    expected: [failed, renewal, renewal],
  });
});
test('unsupported cross-identity and contradictory period facts refuse without rewriting history', () => {
  const crossIdentity: SubscriptionEvidence = {
    ...renewal,
    settlement: {
      ...renewal.settlement,
      kind: 'paid',
      invoiceId: 'in_other',
      period: {
        subscriptionId: 'b'.repeat(24),
        startsAt: '2026-12-01T00:00:00.000Z',
        endsAt: '2027-01-01T00:00:00.000Z',
      },
    },
  };
  const changedInvoice: SubscriptionEvidence = {
    ...paid,
    settlement: {
      kind: 'paid',
      invoiceId: 'in_original',
      period: {
        subscriptionId: 'a'.repeat(24),
        startsAt: '2026-11-01T00:00:00.000Z',
        endsAt: '2027-01-01T00:00:00.000Z',
      },
    },
  };
  assert({
    given:
      'a different local subscription or same invoice with a rewritten period',
    should: 'refuse both observations',
    actual: [crossIdentity, changedInvoice].map((next) =>
      reconcileSubscriptionEvidence(paid, next),
    ),
    expected: [null, null],
  });
});
test('new nonpayment and reversible vendor suspension retain payment facts without manufacturing access', () => {
  assert({
    given:
      'unpaid or paused status after a known payment, then a legitimate paid recovery',
    should: 'keep the current vendor lifecycle and original payment',
    actual: [
      reconcileSubscriptionEvidence(null, {
        lifecycle: 'incomplete',
        settlement: { kind: 'unpaid' },
      }),
      reconcileSubscriptionEvidence(paid, {
        lifecycle: 'unpaid',
        settlement: { kind: 'unpaid' },
      }),
      reconcileSubscriptionEvidence({ ...paid, lifecycle: 'paused' }, renewal),
    ],
    expected: [
      { lifecycle: 'incomplete', settlement: { kind: 'unpaid' } },
      { ...paid, lifecycle: 'unpaid' },
      renewal,
    ],
  });
});
