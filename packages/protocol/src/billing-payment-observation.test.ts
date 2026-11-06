import { unknownPaymentFacts } from './billing-payment-observation-facts';
import { recordInvoiceEnumeration } from './billing-payment-observation-retention';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  classifyPaymentObservation,
  paymentObservationComplete,
} from './billing-payment-observation-policy';
import { billingPaymentObservationSchema } from './billing-payment-observation';
import {
  observation,
  owner,
  proof,
  context,
  originalAction,
} from './billing-payment-observation.test-support';
setupRitewayBun();

test('payment facts retain unknowns without a fabricated charge, amount, time or refund identity', () => {
  const value = observation();
  assert({
    given:
      'actual invoice/payment identities whose allocation and charge are not known',
    should: 'remain owed with explicit unknown facts and no money authority',
    actual: [
      value.state,
      unknownPaymentFacts(),
      classifyPaymentObservation(value, null, context),
      paymentObservationComplete(value),
    ],
    expected: [
      {
        kind: 'owed',
        reason: 'payment_unresolved',
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
      },
      {
        status: null,
        paidAtSeconds: null,
        amountPaidMinor: null,
        charge: { kind: 'unresolved' },
        period: null,
      },
      { kind: 'refuse' },
      false,
    ],
  });
});

test('positive payment chronology distinguishes pre-closure, overlap, future evidence and refund need without creating an action', () => {
  const value = observation();
  const outcomes = [1, 2, 3, 7].map((second) =>
    classifyPaymentObservation(
      value,
      {
        ...proof,
        paidAtSeconds: Date.parse(`2026-11-05T00:00:0${second}.000Z`) / 1000,
      },
      context,
    ),
  );
  assert({
    given:
      'whole verified allocations safely before closure, in its overlapping second, after closure and beyond the current clock',
    should:
      'resolve only proven pre-closure facts and otherwise retain explicit owed classification without an action/key',
    actual: outcomes.map((result) =>
      result.kind === 'recorded'
        ? [
            result.observation.state.kind,
            result.observation.state.kind === 'owed'
              ? result.observation.state.reason
              : result.observation.state.kind === 'resolved'
                ? result.observation.state.basis
                : null,
            paymentObservationComplete(result.observation),
          ]
        : result,
    ),
    expected: [
      ['resolved', 'pre_closure', true],
      ['owed', 'chronology_ambiguous', false],
      ['owed', 'refund_required', false],
      ['owed', 'chronology_ambiguous', false],
    ],
  });
});

test('refund linkage converges on the original action and only its current successful result completes the observation', () => {
  const action = originalAction(),
    states = ['pending', 'failed', 'requires_action', 'succeeded'] as const;
  const known = states.map((status) => ({
    ...action,
    state: {
      kind: 'known' as const,
      startedAt: action.admittedAt,
      refundId: 're_original',
      status,
      observedAt: context.now,
    },
  }));
  const linked = classifyPaymentObservation(
    observation(),
    proof,
    context,
    action,
  );
  if (linked.kind !== 'recorded') throw Error('Expected original linkage');
  assert({
    given:
      'one verified eligible original charge/action with non-monotonic refund outcomes',
    should:
      'retain the same money identity and keep pending, failed, action-required or missing outcomes owed',
    actual: [
      linked.observation.state.kind,
      linked.observation.kind === 'payment' &&
        linked.observation.refundActionId,
      [undefined, action, ...known].map((current) =>
        paymentObservationComplete(linked.observation, current),
      ),
    ],
    expected: [
      'refund-linked',
      action.id,
      [false, false, false, false, false, true],
    ],
  });
});

test('an invoice-only witness needs positive retained-identity coverage and never a fake payment ID or empty-list relief', () => {
  const invoice = billingPaymentObservationSchema.parse({
    ...owner,
    kind: 'invoice',
    state: { kind: 'owed', reason: 'enumeration_unavailable' },
  });
  const coverage = {
    kind: 'complete',
    mode: owner.mode,
    customerId: owner.customerId,
    invoiceId: owner.invoiceId,
    paymentCount: 3,
    lastPaymentId: 'inpay_last',
  };
  const rejected = [
    null,
    { kind: 'exhausted' },
    { ...coverage, paymentCount: 0 },
    { ...coverage, customerId: 'cus_other' },
    { ...coverage, lastPaymentId: 'missing' },
  ].map((value) => recordInvoiceEnumeration(invoice, value, context));
  const covered = recordInvoiceEnumeration(invoice, coverage, context);
  assert({
    given:
      'an owned invoice whose payment identities were initially not enumerable, followed by exact durable coverage',
    should:
      'retain its invoice identity on unavailable/empty/foreign proof and resolve enumeration only after all returned actual identities are retained',
    actual: [
      rejected,
      covered.kind,
      covered.kind === 'recorded' && covered.observation.state,
      billingPaymentObservationSchema.safeParse({
        ...invoice,
        invoicePaymentId: 'inpay_fake',
      }).success,
    ],
    expected: [
      Array(5).fill({ kind: 'refuse' }),
      'recorded',
      {
        kind: 'resolved',
        basis: 'enumeration_retained',
        paymentCount: 3,
        lastPaymentId: 'inpay_last',
      },
      false,
    ],
  });
});
