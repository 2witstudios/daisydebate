import { unknownPaymentFacts } from './billing-payment-observation-facts';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { billingPaymentObservationSchema } from './billing-payment-observation';
import {
  classifyPaymentObservation,
  paymentObservationComplete,
} from './billing-payment-observation-policy';
import {
  observation,
  proof,
  context,
  originalAction,
} from './billing-payment-observation.test-support';
setupRitewayBun();

test('source/config drift, foreign financial identity and stale account/clock context refuse without mutating retained facts', () => {
  const value = observation(),
    before = structuredClone(value);
  const results = [
    classifyPaymentObservation(
      value,
      { ...proof, priceId: 'price_changed' },
      context,
    ),
    classifyPaymentObservation(
      value,
      { ...proof, customerId: 'cus_foreign' },
      context,
    ),
    classifyPaymentObservation(
      value,
      { ...proof, invoiceId: 'in_foreign' },
      context,
    ),
    classifyPaymentObservation(value, proof, {
      ...context,
      userId: 'x'.repeat(24),
    }),
    classifyPaymentObservation(value, proof, {
      ...context,
      now: '2026-11-05T00:00:04.000Z',
    }),
    classifyPaymentObservation(
      {
        ...value,
        source: {
          kind: 'unresolved',
          vendorSubscriptionId: null,
          priceId: null,
        },
      },
      proof,
      context,
    ),
  ];
  assert({
    given:
      'current price substitution, foreign linkage, stale context or missing original source',
    should: 'refuse rather than clean-pass or bind a guessed original offer',
    actual: [results, value],
    expected: [Array(6).fill({ kind: 'refuse' }), before],
  });
});

test('shared or partial allocation facts cannot be replaced by a whole-charge claim and remain explicitly owed', () => {
  const value = observation();
  value.state = {
    kind: 'owed',
    reason: 'payment_unresolved',
    evidence: {
      kind: 'partial',
      facts: {
        ...unknownPaymentFacts(),
        status: 'paid',
        amountPaidMinor: 500,
        charge: {
          kind: 'observed',
          id: proof.chargeId,
          paid: true,
          capturedMinor: 1000,
          currency: 'usd',
        },
      },
    },
  };
  const result = classifyPaymentObservation(value, proof, context);
  assert({
    given:
      'positively observed partial invoice allocation sharing a larger captured charge',
    should:
      'preserve those facts and refuse whole-charge relief or an invented second action',
    actual: [
      result.kind,
      result.kind === 'recorded' && result.observation.state,
      result.kind === 'recorded' &&
        paymentObservationComplete(result.observation),
    ],
    expected: [
      'recorded',
      { ...value.state, reason: 'conflicting_evidence' },
      false,
    ],
  });
});

test('contradictory financial facts stay owed and cannot be cleared by a later matching snapshot', () => {
  const first = classifyPaymentObservation(observation(), proof, context);
  if (first.kind !== 'recorded') throw Error('Expected verified owed proof');
  const conflict = classifyPaymentObservation(
    first.observation,
    { ...proof, chargeId: 'ch_changed' },
    context,
  );
  if (conflict.kind !== 'recorded') throw Error('Expected retained conflict');
  const again = classifyPaymentObservation(
    conflict.observation,
    proof,
    context,
  );
  assert({
    given:
      'a later response changes the original charged identity and another matches the old one again',
    should:
      'retain original proof with sticky owed conflict instead of silently rebinding or clearing it',
    actual: [
      conflict.observation.state,
      again.kind,
      again.kind === 'recorded' && again.observation.state,
    ],
    expected: [
      {
        kind: 'owed',
        reason: 'conflicting_evidence',
        evidence: { kind: 'verified', payment: proof },
      },
      'recorded',
      {
        kind: 'owed',
        reason: 'conflicting_evidence',
        evidence: { kind: 'verified', payment: proof },
      },
    ],
  });
});

test('another invoice/account/period cannot link or settle an observation through the same charge', () => {
  const action = originalAction();
  const linked = classifyPaymentObservation(
    observation(),
    proof,
    context,
    action,
  );
  if (linked.kind !== 'recorded') throw Error('Expected matching action');
  const foreign = [
    { ...action, userId: 'x'.repeat(24) },
    { ...action, invoiceId: 'in_other' },
    { ...action, amountMinor: 500 },
    {
      ...action,
      period: { ...action.period, endsAt: '2026-12-02T00:00:00.000Z' },
    },
  ];
  const states = foreign.map((other) =>
    classifyPaymentObservation(observation(), proof, context, other),
  );
  assert({
    given:
      'a shared charge/action reference with different original ownership, allocation or billing period',
    should:
      'keep conflict owed and reject unrelated successful-action completion',
    actual: [
      states.map(
        (value) =>
          value.kind === 'recorded' &&
          value.observation.state.kind === 'owed' &&
          value.observation.state.reason,
      ),
      foreign.map((other) =>
        paymentObservationComplete(linked.observation, {
          ...other,
          state: {
            kind: 'known',
            startedAt: action.admittedAt,
            refundId: 're_original',
            status: 'succeeded',
            observedAt: context.now,
          },
        }),
      ),
      billingPaymentObservationSchema.safeParse({
        ...observation(),
        state: {
          kind: 'resolved',
          basis: 'pre_closure',
          evidence: { kind: 'verified', payment: proof },
        },
      }).success,
    ],
    expected: [
      Array(4).fill('conflicting_evidence'),
      Array(4).fill(false),
      false,
    ],
  });
});

test('retained boundary money effects can link for reconciliation without authorizing a fresh ambiguous refund', () => {
  const closedAt = '2026-11-05T00:00:02.000Z';
  const boundary = { ...proof, paidAtSeconds: Date.parse(closedAt) / 1000 };
  const value = { ...observation(), closedAt };
  const ready = {
    ...originalAction(),
    closedAt,
    paidAtSeconds: boundary.paidAtSeconds,
  };
  const known = {
    ...ready,
    state: {
      kind: 'known' as const,
      startedAt: ready.admittedAt,
      refundId: 're_original',
      status: 'succeeded' as const,
      observedAt: context.now,
    },
  };
  const refused = classifyPaymentObservation(
    value,
    boundary,
    { ...context, closedAt },
    ready,
  );
  const recovered = classifyPaymentObservation(
    value,
    boundary,
    { ...context, closedAt },
    known,
  );
  assert({
    given:
      'ambiguous same-second chronology and an already executed matching original refund',
    should:
      'preserve recovery linkage for the existing effect while denying a new ready-action eligibility interpretation',
    actual: [
      refused.kind === 'recorded' &&
        refused.observation.state.kind === 'owed' &&
        refused.observation.state.reason,
      recovered.kind === 'recorded' &&
        recovered.observation.kind === 'payment' &&
        recovered.observation.refundActionId,
      recovered.kind === 'recorded' &&
        paymentObservationComplete(recovered.observation, known),
    ],
    expected: ['chronology_ambiguous', ready.id, true],
  });
});
