import { unknownPaymentFacts } from './billing-payment-observation-facts';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { billingPaymentObservationSchema } from './billing-payment-observation';
import {
  classifyPaymentChronology,
  classifyPaymentObservation,
  paymentObservationComplete,
} from './billing-payment-observation-policy';
import { retainPaymentObservationFacts } from './billing-payment-observation-retention';
import {
  observation,
  owner,
  proof,
  context,
  originalAction,
  chronologyProof,
} from './billing-payment-observation.test-support';
setupRitewayBun();
const paidSecond = (second: number) =>
  Date.parse(`2026-11-05T00:00:0${second}.000Z`) / 1000;

test('exact owned paid chronology resolves only its pre-closure payment while amount, charge and period stay unknown', () => {
  const evidence = chronologyProof(paidSecond(1));
  const resolved = classifyPaymentChronology(observation(), evidence, context);
  assert({
    given:
      'positively retrieved paid status and an owned whole timestamp second before closure, with no charge/allocation fields',
    should:
      'retain typed minimal chronology rather than fabricate full money facts or a refund action',
    actual: [
      resolved.kind,
      resolved.kind === 'recorded' && resolved.observation.state,
      resolved.kind === 'recorded' &&
        resolved.observation.kind === 'payment' &&
        resolved.observation.refundActionId,
      resolved.kind === 'recorded' &&
        paymentObservationComplete(resolved.observation),
    ],
    expected: [
      'recorded',
      {
        kind: 'resolved',
        basis: 'pre_closure',
        evidence: {
          kind: 'chronology',
          proof: evidence,
          facts: {
            ...unknownPaymentFacts(),
            status: 'paid',
            paidAtSeconds: paidSecond(1),
          },
        },
      },
      null,
      true,
    ],
  });
});

test('second precision allows exact upper-bound pre-closure but equal, overlap, post and future seconds stay owed without full money proof', () => {
  const cases = [
    { closedAt: '2026-11-05T00:00:02.000Z', paid: 1 },
    { closedAt: '2026-11-05T00:00:02.000Z', paid: 2 },
    { closedAt: context.closedAt, paid: 2 },
    { closedAt: context.closedAt, paid: 3 },
    { closedAt: context.closedAt, paid: 7 },
  ];
  const results = cases.map(({ closedAt, paid }) =>
    classifyPaymentChronology(
      { ...observation(), closedAt },
      chronologyProof(paidSecond(paid)),
      { ...context, closedAt },
    ),
  );
  assert({
    given:
      'boundary seconds at original vendor precision and a valid current post-lock clock',
    should:
      'resolve only a completely preceding second and never infer refund authority from minimal post-closure chronology',
    actual: results.map((result) =>
      result.kind === 'recorded'
        ? [
            result.observation.state.kind,
            result.observation.kind === 'payment' &&
              result.observation.refundActionId,
          ]
        : result,
    ),
    expected: [
      ['resolved', null],
      ['owed', null],
      ['owed', null],
      ['owed', null],
      ['owed', null],
    ],
  });
});

test('foreign mode, invoice, payment, customer, source, nonpaid or missing timestamp proof cannot resolve an observation', () => {
  const original = observation(),
    evidence = chronologyProof(paidSecond(1));
  const bad = [
    { ...evidence, mode: 'live' },
    { ...evidence, invoiceId: 'in_other' },
    { ...evidence, invoicePaymentId: 'inpay_other' },
    { ...evidence, customerId: 'cus_other' },
    { ...evidence, priceId: 'price_current' },
    { ...evidence, vendorSubscriptionId: 'sub_other' },
    { ...evidence, status: 'open' },
    { ...evidence, status: 'canceled' },
    { ...evidence, paidAtSeconds: null },
    { ...evidence, paidAtSeconds: undefined },
  ];
  assert({
    given: 'uncorrelated, nonpaid or missing paid-time input',
    should:
      'refuse all without weakening exact ownership or inventing an absent value',
    actual: [
      bad.map((item) => classifyPaymentChronology(original, item, context)),
      original.state,
    ],
    expected: [Array(10).fill({ kind: 'refuse' }), observation().state],
  });
});

test('minimal chronology never resolves enumeration, another payment, a conflicting fact or an independently bound refund action', () => {
  const exact = chronologyProof(paidSecond(1));
  const other = {
    ...observation(),
    id: 'b'.repeat(24),
    invoicePaymentId: 'inpay_other',
  };
  const witness = billingPaymentObservationSchema.parse({
    ...owner,
    kind: 'invoice',
    state: { kind: 'owed', reason: 'enumeration_unavailable' },
  });
  const bound = classifyPaymentObservation(
    observation(),
    proof,
    context,
    originalAction(),
  );
  if (bound.kind !== 'recorded') throw Error('Expected action binding');
  const original = structuredClone(bound.observation);
  const conflict = classifyPaymentChronology(bound.observation, exact, context);
  assert({
    given:
      'a different exact payment, an invoice enumeration witness and retained contradictory original-money evidence',
    should:
      'resolve none of those and preserve the original independently owed action identity',
    actual: [
      classifyPaymentChronology(other, exact, context),
      classifyPaymentChronology(witness, exact, context),
      other.state,
      witness.state,
      conflict.kind === 'recorded' &&
        conflict.observation.kind === 'payment' && [
          conflict.observation.refundActionId,
          conflict.observation.state.kind === 'owed' &&
            conflict.observation.state.reason,
        ],
      bound.observation,
    ],
    expected: [
      { kind: 'refuse' },
      { kind: 'refuse' },
      observation().state,
      { kind: 'owed', reason: 'enumeration_unavailable' },
      [originalAction().id, 'conflicting_evidence'],
      original,
    ],
  });
});

test('an unavailable later read cannot erase minimal positive chronology or supply money facts', () => {
  const resolved = classifyPaymentChronology(
    observation(),
    chronologyProof(paidSecond(1)),
    context,
  );
  if (resolved.kind !== 'recorded')
    throw Error('Expected chronology classification');
  const later = retainPaymentObservationFacts(
    resolved.observation,
    unknownPaymentFacts(),
    { ...context, now: '2026-11-05T00:00:07.000Z' },
  );
  assert({
    given:
      'positive pre-closure chronology followed by an unavailable vendor read',
    should:
      'retain its exact proof and unknown financial fields without a new action',
    actual: [
      later.kind,
      later.kind === 'recorded' && later.observation.state,
      later.kind === 'recorded' &&
        later.observation.kind === 'payment' &&
        later.observation.refundActionId,
    ],
    expected: ['recorded', resolved.observation.state, null],
  });
});
