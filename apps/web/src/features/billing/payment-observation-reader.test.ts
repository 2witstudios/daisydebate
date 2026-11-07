import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import { createPaymentObservationReader } from './payment-observation-reader';
import {
  owner,
  payment,
  charge,
  intent,
  facts,
} from './closure-payment.test-support';
setupRitewayBun();
const invoice = {
  mode: owner.mode,
  customerId: owner.customerId,
  invoiceId: facts.invoice.id,
  source: {
    kind: 'purchase',
    purchaseId: 'p'.repeat(24),
    vendorSubscriptionId: owner.vendorSubscriptionId,
    priceId: owner.priceId,
    admittedAt: '2026-01-01T00:00:00.000Z',
  },
};
const expanded = {
  ...payment,
  invoice: facts.invoice,
  payment: {
    type: 'payment_intent',
    payment_intent: { ...intent, latest_charge: charge },
  },
};
const request = { invoice, paymentId: payment.id, closedAt: facts.closedAt };
const reader = (value: unknown) =>
  createPaymentObservationReader({
    mode: 'test',
    clock: fixedClock(facts.now),
    port: { payment: async () => value },
  });

test('full exact-charge proof and partial invoice allocation retain different financial authority', async () => {
  const full = await reader(expanded)(request);
  const partial = await reader({ ...expanded, amount_paid: 600 })(request);
  assert({
    given:
      'one complete owned original payment and a smaller invoice allocation on the same captured charge',
    should:
      'retain full proof only for whole allocation while preserving actual partial amounts and charge without inventing a refund',
    actual: [
      full.kind === 'read' && full.read.evidence.kind,
      partial.kind === 'read' && partial.read.evidence.kind,
      partial.kind === 'read' &&
        partial.read.evidence.kind !== 'verified' &&
        partial.read.evidence.facts,
    ],
    expected: [
      'verified',
      'chronology',
      {
        status: 'paid',
        paidAtSeconds: payment.status_transitions.paid_at,
        amountPaidMinor: 600,
        charge: {
          kind: 'observed',
          id: charge.id,
          paid: true,
          capturedMinor: 1000,
          currency: 'usd',
        },
        period: null,
      },
    ],
  });
});

test('owned payment chronology does not require charge/allocation evidence or infer absent facts', async () => {
  const result = await reader({
    ...payment,
    amount_paid: undefined,
    invoice: facts.invoice,
    payment: undefined,
  })(request);
  assert({
    given:
      'a positively retrieved owned paid InvoicePayment without expanded financial links or allocation',
    should:
      'preserve exact paid second with unknown money fields for fenced classification',
    actual: result.kind === 'read' && result.read.evidence,
    expected: {
      kind: 'chronology',
      proof: {
        ...owner,
        invoiceId: invoice.invoiceId,
        invoicePaymentId: payment.id,
        status: 'paid',
        paidAtSeconds: payment.status_transitions.paid_at,
      },
      facts: {
        status: 'paid',
        paidAtSeconds: payment.status_transitions.paid_at,
        amountPaidMinor: null,
        charge: { kind: 'unresolved' },
        period: null,
      },
    },
  });
});

test('foreign/malformed replies and read failures cannot become absence, payment classification or private output', async () => {
  const responses = [
    null,
    { ...expanded, id: 'inpay_other' },
    { ...expanded, livemode: true },
    { ...expanded, invoice: { ...facts.invoice, customer: 'cus_other' } },
  ];
  const results = await Promise.all(responses.map((x) => reader(x)(request)));
  const failed = await createPaymentObservationReader({
    mode: 'test',
    clock: fixedClock(facts.now),
    port: {
      payment: async () => {
        throw Error('private vendor body');
      },
    },
  })(request);
  let calls = 0;
  const invalid = await createPaymentObservationReader({
    mode: 'live',
    clock: fixedClock(facts.now),
    port: {
      payment: async () => {
        calls++;
        return expanded;
      },
    },
  })(request);
  assert({
    given:
      'foreign payment/mode/invoice evidence, transport failure and unsupported original mode',
    should:
      'return only unavailable and avoid transport for invalid local mode',
    actual: [results, failed, invalid, calls],
    expected: [
      responses.map(() => ({ kind: 'unavailable' })),
      { kind: 'unavailable' },
      { kind: 'unavailable' },
      0,
    ],
  });
});
