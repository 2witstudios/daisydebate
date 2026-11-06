import { assert, setupRitewayBun, test } from 'riteway/bun';
import { observeClosurePaymentChronology } from './closure-payment';
import { owner, payment, facts } from './closure-payment.test-support';
setupRitewayBun();
const input = () => ({
  owner,
  invoiceId: facts.invoice.id,
  invoicePaymentId: payment.id,
  invoice: facts.invoice,
  invoicePayment: {
    id: payment.id,
    object: payment.object,
    invoice: facts.invoice.id,
    livemode: false,
    status: 'paid',
    status_transitions: payment.status_transitions,
  },
});

test('owned paid chronology does not require or manufacture charge, amount, allocation or invoice period facts', () => {
  const value = input();
  const line = value.invoice.lines.data[0]!;
  const invoice = {
    ...value.invoice,
    lines: {
      ...value.invoice.lines,
      data: [
        {
          id: line.id,
          quantity: line.quantity,
          livemode: line.livemode,
          parent: line.parent,
          pricing: line.pricing,
        },
      ],
    },
  };
  assert({
    given:
      'positive exact SDK-shaped paid payment and frozen invoice ownership without money/allocation fields',
    should:
      'normalize only the original success second and ownership, leaving financial eligibility to the current fenced policy',
    actual: observeClosurePaymentChronology({ ...value, invoice }),
    expected: {
      kind: 'chronology',
      proof: {
        ...owner,
        invoiceId: value.invoiceId,
        invoicePaymentId: payment.id,
        status: 'paid',
        paidAtSeconds: payment.status_transitions.paid_at,
      },
    },
  });
});

test('chronology normalization refuses foreign identity/mode/source, missing time and incoherent payment status', () => {
  const value = input();
  const variants = [
    { ...value, invoicePaymentId: 'inpay_other' },
    { ...value, invoiceId: 'in_other' },
    {
      ...value,
      invoicePayment: { ...value.invoicePayment, invoice: 'in_other' },
    },
    { ...value, invoicePayment: { ...value.invoicePayment, livemode: true } },
    { ...value, owner: { ...owner, priceId: 'price_current' } },
    { ...value, owner: { ...owner, customerId: 'cus_other' } },
    { ...value, owner: { ...owner, vendorSubscriptionId: 'sub_other' } },
    { ...value, invoicePayment: { ...value.invoicePayment, status: 'open' } },
    {
      ...value,
      invoicePayment: {
        ...value.invoicePayment,
        status_transitions: { paid_at: null, canceled_at: null },
      },
    },
    {
      ...value,
      invoicePayment: {
        ...value.invoicePayment,
        status_transitions: { ...payment.status_transitions, canceled_at: 1 },
      },
    },
  ];
  assert({
    given: 'an uncorrelated or nonpositive vendor snapshot',
    should:
      'retain unresolved status rather than substitute invoice creation/arrival or fabricate paid chronology',
    actual: variants.map(observeClosurePaymentChronology),
    expected: variants.map(() => ({ kind: 'unresolved' })),
  });
});
