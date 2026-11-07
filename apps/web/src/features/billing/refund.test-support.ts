import { advanceRefund, refundActionSchema } from '@daisy/protocol/billing';
export function refundFixture() {
  const now = '2026-11-05T00:00:03.000Z';
  const claimId = 'c'.repeat(24);
  const base = refundActionSchema.parse({
    id: 'r'.repeat(24),
    userId: 'u'.repeat(24),
    mode: 'test',
    customerId: 'cus_original',
    chargeId: 'ch_original',
    invoiceId: 'in_original',
    vendorSubscriptionId: 'sub_original',
    amountMinor: 1000,
    currency: 'usd',
    period: {
      startsAt: '2026-11-01T00:00:00.000Z',
      endsAt: '2026-12-01T00:00:00.000Z',
    },
    closedAt: '2026-11-05T00:00:00.000Z',
    paidAtSeconds: 1793836801,
    admittedAt: '2026-11-05T00:00:02.000Z',
    state: { kind: 'ready' },
    claim: null,
  });
  const transition = advanceRefund(
    base,
    { kind: 'claim', claimId },
    { now, authority: 'closed' },
  );
  if (transition.kind !== 'changed') throw Error('Fixture claim refused');
  const action = transition.action;
  const refund = {
    object: 'refund',
    id: 're_original',
    charge: 'ch_original',
    customer: 'cus_original',
    amount: 1000,
    currency: 'usd',
    status: 'pending',
    metadata: { daisy_refund_action_id: base.id },
  };
  const unexpected = async () => {
    throw Error('Unexpected transport');
  };

  return { now, claimId, base, action, refund, unexpected };
}
