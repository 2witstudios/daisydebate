import { assert, setupRitewayBun, test } from 'riteway/bun';
import { observeClosurePayment } from './closure-payment';
import {
  identity,
  invoice,
  start,
  end,
  iso,
} from './subscription-observation.test-support';

setupRitewayBun();
const owner = {
  customerId: identity.customerId,
  vendorSubscriptionId: identity.vendorSubscriptionId,
  priceId: identity.priceId,
  mode: identity.mode,
};
const payment = {
  id: 'inpay_original',
  object: 'invoice_payment',
  invoice: invoice.id,
  livemode: false,
  currency: 'usd',
  status: 'paid',
  amount_paid: 1000,
  amount_requested: 1000,
  is_default: true,
  status_transitions: { paid_at: start + 5, canceled_at: null },
  payment: { type: 'payment_intent', payment_intent: 'pi_original' },
};
const charge = {
  id: 'ch_original',
  object: 'charge',
  customer: owner.customerId,
  livemode: false,
  currency: 'usd',
  paid: true,
  captured: true,
  status: 'succeeded',
  amount: 1000,
  amount_captured: 1000,
  payment_intent: 'pi_original',
};
const intent = {
  id: 'pi_original',
  object: 'payment_intent',
  customer: owner.customerId,
  livemode: false,
  currency: 'usd',
  status: 'succeeded',
  amount_received: 1000,
  latest_charge: charge.id,
};
const facts = {
  owner,
  closedAt: iso(start + 4),
  now: iso(start + 10),
  invoice: { ...invoice, amount_paid: 1000 },
  invoicePayment: payment,
  charge,
  paymentIntent: intent,
};

test('verified original charge allocation preserves its invoice period and payment-success chronology', () => {
  assert({
    given:
      'matching owned monthly invoice, paid InvoicePayment, succeeded PaymentIntent and captured charge',
    should: 'identify the exact original-charge obligation and period',
    actual: observeClosurePayment(facts),
    expected: {
      kind: 'refund',
      payment: {
        mode: 'test',
        customerId: owner.customerId,
        chargeId: charge.id,
        invoiceId: invoice.id,
        vendorSubscriptionId: owner.vendorSubscriptionId,
        amountMinor: 1000,
        currency: 'usd',
        paidAtSeconds: start + 5,
        period: { startsAt: iso(start), endsAt: iso(end) },
      },
    },
  });
});

test('invoice arrival, creation and invoice-level settlement cannot replace charge-payment chronology', () => {
  const times = [start + 3, start + 4, start + 5, null];
  assert({
    given:
      'the same invoice received after closure but four different payment-success facts',
    should:
      'separate pre-closure, second-overlap, post-closure and unresolved payment without using arrival',
    actual: times.map(
      (paid_at) =>
        observeClosurePayment({
          ...facts,
          closedAt: new Date((start + 4) * 1000 + 500).toISOString(),
          invoice: {
            ...facts.invoice,
            created: start + 9,
            status_transitions: { paid_at: start + 9 },
          },
          invoicePayment: {
            ...payment,
            status_transitions: { paid_at, canceled_at: null },
          },
        }).kind,
    ),
    expected: ['pre-closure', 'unresolved', 'refund', 'unresolved'],
  });
});

test('foreign, partial, unresolved or inconsistent financial evidence stays owed', () => {
  const bad = [
    { owner: { ...owner, mode: 'live' } },
    { owner: { ...owner, priceId: 'price_other' } },
    { owner: { ...owner, vendorSubscriptionId: 'sub_other' } },
    { invoice: { ...facts.invoice, customer: 'cus_other' } },
    { invoice: { ...facts.invoice, amount_paid: 999 } },
    {
      invoice: {
        ...facts.invoice,
        lines: { ...invoice.lines, has_more: true },
      },
    },
    {
      invoice: {
        ...facts.invoice,
        lines: {
          ...invoice.lines,
          data: [{ ...invoice.lines.data[0], amount: 999 }],
        },
      },
    },
    { invoicePayment: { ...payment, invoice: 'in_other' } },
    { invoicePayment: { ...payment, status: 'open' } },
    { invoicePayment: { ...payment, amount_paid: 500 } },
    {
      invoicePayment: {
        ...payment,
        status_transitions: { paid_at: start + 20, canceled_at: null },
      },
    },
    { charge: { ...charge, customer: 'cus_other' } },
    { charge: { ...charge, livemode: true } },
    { charge: { ...charge, captured: false } },
    { charge: { ...charge, payment_intent: 'pi_other' } },
    { charge: { ...charge, currency: 'eur' } },
    { paymentIntent: { ...intent, latest_charge: 'ch_other' } },
    { paymentIntent: { ...intent, amount_received: 2000 } },
    { paymentIntent: { ...intent, status: 'processing' } },
  ];
  assert({
    given:
      'cross-mode/owner/invoice/price, incomplete lists, shared allocation, unknown settlement and mismatched charge links',
    should: 'produce no refund authorization from any invalid evidence',
    actual: bad.map(
      (patch) => observeClosurePayment({ ...facts, ...patch }).kind,
    ),
    expected: bad.map(() => 'unresolved'),
  });
});

test('equal vendor second preserves ambiguity at a precise local closure boundary', () => {
  const seconds = start + 5;
  const boundaries = [seconds - 1, seconds, seconds + 0.5, seconds + 1];
  assert({
    given:
      'one original second-resolution payment timestamp and local closure before, equal, within, or after its supported interval',
    should:
      'preserve the original seconds and authorize only wholly post-closure payment',
    actual: boundaries.map(
      (boundary) =>
        observeClosurePayment({
          ...facts,
          closedAt: new Date(boundary * 1000).toISOString(),
        }).kind,
    ),
    expected: ['refund', 'unresolved', 'unresolved', 'pre-closure'],
  });
});
