import { unknownPaymentFacts } from './billing-payment-observation-facts';
import {
  retainPaymentObservationFacts,
  retainPaymentObservationSource,
} from './billing-payment-observation-retention';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { billingPaymentObservationSchema } from './billing-payment-observation';
import {
  classifyPaymentObservation,
  paymentObservationComplete,
} from './billing-payment-observation-policy';
import {
  observation,
  owner,
  proof,
  context,
  originalAction,
} from './billing-payment-observation.test-support';
setupRitewayBun();

test('later missing facts cannot erase positive partial allocation or invent a whole-charge classification', () => {
  const facts = {
    ...unknownPaymentFacts(),
    status: 'paid' as const,
    paidAtSeconds: proof.paidAtSeconds,
    amountPaidMinor: 500,
    charge: {
      kind: 'observed' as const,
      id: proof.chargeId,
      paid: true,
      capturedMinor: 1000,
      currency: 'usd',
    },
  };
  const retained = retainPaymentObservationFacts(observation(), facts, context);
  if (retained.kind !== 'recorded')
    throw Error('Expected retained partial facts');
  const absent = retainPaymentObservationFacts(
    retained.observation,
    unknownPaymentFacts(),
    { ...context, now: '2026-11-05T00:00:07.000Z' },
  );
  if (absent.kind !== 'recorded')
    throw Error('Expected unavailable reread retention');
  const conflict = retainPaymentObservationFacts(
    absent.observation,
    { ...facts, amountPaidMinor: 1000 },
    { ...context, now: '2026-11-05T00:00:08.000Z' },
  );
  assert({
    given:
      'a positive partial allocation followed by vendor disappearance and a contradictory whole amount',
    should:
      'retain original exact evidence and sticky owed conflict without a new charge/key or clean-pass relief',
    actual: [
      retained.observation.state,
      absent.observation.state,
      conflict.kind,
      conflict.kind === 'recorded' && conflict.observation.state,
      paymentObservationComplete(absent.observation),
    ],
    expected: [
      {
        kind: 'owed',
        reason: 'payment_unresolved',
        evidence: { kind: 'partial', facts },
      },
      {
        kind: 'owed',
        reason: 'payment_unresolved',
        evidence: { kind: 'partial', facts },
      },
      'recorded',
      {
        kind: 'owed',
        reason: 'conflicting_evidence',
        evidence: { kind: 'partial', facts },
      },
      false,
    ],
  });
});

test('completed-looking scalar facts still require actual verified payment linkage before classification', () => {
  const open = retainPaymentObservationFacts(
    observation(),
    { ...unknownPaymentFacts(), status: 'open' },
    context,
  );
  if (open.kind !== 'recorded') throw Error('Expected open retention');
  const facts = {
    status: 'paid' as const,
    paidAtSeconds: proof.paidAtSeconds,
    amountPaidMinor: 1000,
    charge: {
      kind: 'observed' as const,
      id: proof.chargeId,
      paid: true,
      capturedMinor: 1000,
      currency: 'usd',
    },
    period: proof.period,
  };
  const paid = retainPaymentObservationFacts(open.observation, facts, context);
  if (paid.kind !== 'recorded') throw Error('Expected partial retention');
  const verified = classifyPaymentObservation(paid.observation, proof, context);
  assert({
    given:
      'open payment later has matching amounts and charge references but not yet certified ownership/allocation',
    should:
      'remain partially owed until separately verified linked evidence establishes only refund need',
    actual: [
      paid.observation.state,
      verified.kind,
      verified.kind === 'recorded' && verified.observation.state,
      paymentObservationComplete(paid.observation),
    ],
    expected: [
      {
        kind: 'owed',
        reason: 'payment_unresolved',
        evidence: { kind: 'partial', facts },
      },
      'recorded',
      {
        kind: 'owed',
        reason: 'refund_required',
        evidence: { kind: 'verified', payment: proof },
      },
      false,
    ],
  });
});

test('missing original source can be enriched once but never replaced by current price, another purchase or absent reread', () => {
  const value = {
    ...observation(),
    source: {
      kind: 'unresolved' as const,
      vendorSubscriptionId: owner.source.vendorSubscriptionId,
      priceId: null,
    },
  };
  const original = retainPaymentObservationSource(value, owner.source, context);
  if (original.kind !== 'recorded') throw Error('Expected original enrichment');
  const absent = retainPaymentObservationSource(
    original.observation,
    { kind: 'unresolved', vendorSubscriptionId: null, priceId: null },
    context,
  );
  const conflict = retainPaymentObservationSource(
    original.observation,
    { ...owner.source, priceId: 'price_current' },
    context,
  );
  const other = retainPaymentObservationSource(
    original.observation,
    { ...owner.source, purchaseId: 'x'.repeat(24) },
    context,
  );
  assert({
    given:
      'a retained actual subscription reference and later verified original purchase offer',
    should:
      'enrich missing source knowledge, retain it through absence and refuse rebinding as owed conflict',
    actual: [
      original.observation.source,
      absent.kind === 'recorded' && absent.observation.source,
      [conflict, other].map(
        (result) =>
          result.kind === 'recorded' && [
            result.observation.source,
            result.observation.state.kind === 'owed' &&
              result.observation.state.reason,
          ],
      ),
    ],
    expected: [
      owner.source,
      owner.source,
      Array(2).fill([owner.source, 'conflicting_evidence']),
    ],
  });
});

test('invoice coverage cannot erase an original-source conflict or create a payment identity', () => {
  const witness = billingPaymentObservationSchema.parse({
    ...owner,
    kind: 'invoice',
    state: {
      kind: 'resolved',
      basis: 'enumeration_retained',
      paymentCount: 1,
      lastPaymentId: 'inpay_original',
    },
  });
  const conflict = retainPaymentObservationSource(
    witness,
    { ...owner.source, vendorSubscriptionId: 'sub_other' },
    context,
  );
  assert({
    given:
      'positive enumeration coverage followed by conflicting frozen source ownership',
    should:
      'preserve the actual invoice/source and reopen only its enumeration obligation without inventing money facts',
    actual: [
      conflict.kind,
      conflict.kind === 'recorded' && conflict.observation.source,
      conflict.kind === 'recorded' && conflict.observation.state,
      conflict.kind === 'recorded' &&
        paymentObservationComplete(conflict.observation),
    ],
    expected: [
      'recorded',
      owner.source,
      { kind: 'owed', reason: 'conflicting_evidence' },
      false,
    ],
  });
});

test('a linked observation cannot lose or replace its original action even when later evidence conflicts or disappears', () => {
  const action = originalAction();
  const linked = classifyPaymentObservation(
    observation(),
    proof,
    context,
    action,
  );
  if (linked.kind !== 'recorded') throw Error('Expected linked observation');
  const absent = classifyPaymentObservation(linked.observation, proof, context);
  const replaced = classifyPaymentObservation(
    linked.observation,
    proof,
    context,
    { ...action, id: 'x'.repeat(24) },
  );
  const forgotten = billingPaymentObservationSchema.safeParse({
    ...linked.observation,
    refundActionId: null,
  }).success;
  const requestedAgain = billingPaymentObservationSchema.safeParse({
    ...linked.observation,
    state: {
      kind: 'owed',
      reason: 'refund_required',
      evidence: { kind: 'verified', payment: proof },
    },
  }).success;
  assert({
    given:
      'an existing original-charge binding and later missing/different action evidence',
    should:
      'retain the original relational identity, keep conflicts owed and prohibit a fresh unlinked money request',
    actual: [
      absent.kind === 'recorded' &&
        absent.observation.kind === 'payment' &&
        absent.observation.refundActionId,
      replaced.kind === 'recorded' &&
        replaced.observation.kind === 'payment' && [
          replaced.observation.refundActionId,
          replaced.observation.state.kind === 'owed' &&
            replaced.observation.state.reason,
        ],
      forgotten,
      requestedAgain,
    ],
    expected: [action.id, [action.id, 'conflicting_evidence'], false, false],
  });
});
