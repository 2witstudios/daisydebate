import { billingPaymentObservationSchema } from './billing-payment-observation';
import {
  invoicePassOwnerSchema,
  type InvoicePassAuthority,
  type InvoicePass,
} from './billing-invoice-pass';
import {
  startInvoicePass,
  advanceInvoicePass,
} from './billing-invoice-pass-lifecycle';
import { ownedPaymentObservationSchema } from './billing-payment-observation-read';
export const owner = invoicePassOwnerSchema.parse({
  userId: 'u'.repeat(24),
  mode: 'test',
  customerId: 'cus_owned',
  invoiceId: 'in_owned',
  closedAt: '2026-11-06T12:00:00.000Z',
  source: {
    kind: 'purchase',
    purchaseId: 'p'.repeat(24),
    priceId: 'price_original',
    vendorSubscriptionId: 'sub_owned',
    admittedAt: '2026-11-01T00:00:00.000Z',
  },
  period: {
    startsAt: '2026-11-01T00:00:00.000Z',
    endsAt: '2026-12-01T00:00:00.000Z',
  },
});
const time = Date.parse('2026-11-06T12:00:10.000Z');
export function authority(step = 0): InvoicePassAuthority {
  const claimed = time + step * 100;
  return {
    jobId: 'j'.repeat(24),
    userId: owner.userId,
    now: new Date(claimed + 50).toISOString(),
    claim: {
      id: String(step).padStart(24, 'c'),
      claimedAt: new Date(claimed).toISOString(),
      expiresAt: new Date(claimed + 30000).toISOString(),
    },
  };
}
export function read(index: number) {
  return ownedPaymentObservationSchema.parse({
    mode: owner.mode,
    customerId: owner.customerId,
    invoiceId: owner.invoiceId,
    invoicePaymentId: `inpay_${index}`,
    source: owner.source,
    evidence: {
      kind: 'partial',
      facts: {
        status: null,
        paidAtSeconds: null,
        amountPaidMinor: null,
        charge: { kind: 'unresolved' },
        period: null,
      },
    },
  });
}
export function row(
  value: ReturnType<typeof read>,
  context: InvoicePassAuthority,
) {
  return billingPaymentObservationSchema.parse({
    id: value.invoicePaymentId
      .replace(/[^a-z0-9]/g, '')
      .slice(-4)
      .padStart(24, 'r'),
    userId: owner.userId,
    mode: owner.mode,
    customerId: owner.customerId,
    invoiceId: owner.invoiceId,
    invoicePaymentId: value.invoicePaymentId,
    source: value.source,
    kind: 'payment',
    refundActionId: null,
    closedAt: owner.closedAt,
    createdAt: authority().now,
    observedAt: context.now,
    state: {
      kind: 'owed',
      reason: 'payment_unresolved',
      evidence: value.evidence,
    },
  });
}
export function witness(context: InvoicePassAuthority) {
  const value = billingPaymentObservationSchema.parse({
    id: 'w'.repeat(24),
    userId: owner.userId,
    mode: owner.mode,
    customerId: owner.customerId,
    invoiceId: owner.invoiceId,
    source: owner.source,
    kind: 'invoice',
    closedAt: owner.closedAt,
    createdAt: authority().now,
    observedAt: context.now,
    state: { kind: 'owed', reason: 'enumeration_unavailable' },
  });
  if (value.kind !== 'invoice') throw Error('Expected invoice witness');
  return value;
}
export function must(
  value: ReturnType<typeof advanceInvoicePass>,
): InvoicePass {
  if (value.kind !== 'advanced')
    throw Error('Expected advanced pass: ' + JSON.stringify(value));
  return value.pass;
}
export function passWith(count: number) {
  let pass = must(startInvoicePass('i'.repeat(24), owner, authority()));
  for (let index = 1; index <= count; index++) {
    const value = read(index),
      ctx = authority(index);
    pass = must(
      advanceInvoicePass(
        pass,
        {
          kind: 'retained',
          beforeId: pass.afterId,
          read: value,
          observation: row(value, ctx),
          more: index < count,
        },
        ctx,
      ),
    );
  }
  return pass;
}
export function head(
  pass: InvoicePass,
  values: ReturnType<typeof read>[],
  context: InvoicePassAuthority,
) {
  return {
    kind: 'head',
    passId: pass.id,
    jobId: pass.jobId,
    claimId: context.claim.id,
    startedAt: new Date(Date.parse(context.claim.claimedAt) + 5).toISOString(),
    observedAt: new Date(
      Date.parse(context.claim.claimedAt) + 10,
    ).toISOString(),
    owner: pass.owner,
    request: { invoiceId: pass.owner.invoiceId, limit: 20 },
    hasMore: false,
    reads: values,
  };
}
export function invoice(pass: InvoicePass, context: InvoicePassAuthority) {
  return {
    kind: 'invoice',
    passId: pass.id,
    jobId: pass.jobId,
    claimId: context.claim.id,
    startedAt: new Date(Date.parse(context.claim.claimedAt) + 5).toISOString(),
    observedAt: new Date(
      Date.parse(context.claim.claimedAt) + 10,
    ).toISOString(),
    owner: pass.owner,
  };
}
