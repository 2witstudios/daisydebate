import { assert, setupRitewayBun, test } from 'riteway/bun';
import { retainRefundAdmissionConflict } from './billing-payment-observation-policy';
import { applyPaymentObservationRead } from './billing-payment-observation-read';
import { unknownPaymentFacts } from './billing-payment-observation-facts';
import {
  observation,
  context,
  proof,
  chronologyProof,
  originalAction,
} from './billing-payment-observation.test-support';
setupRitewayBun();
const read = () => ({
  mode: proof.mode,
  customerId: proof.customerId,
  invoiceId: proof.invoiceId,
  invoicePaymentId: proof.invoicePaymentId,
  source: observation().source,
  evidence: { kind: 'partial' as const, facts: unknownPaymentFacts() },
});

test('owned payment reads retain unknowns and reject identity changes rather than borrowing another payment proof', () => {
  const value = observation();
  const variants = [
    { ...read(), customerId: 'cus_foreign' },
    { ...read(), invoiceId: 'in_foreign' },
    { ...read(), invoicePaymentId: 'inpay_foreign' },
    {
      ...read(),
      evidence: {
        kind: 'verified',
        payment: { ...proof, invoiceId: 'in_foreign' },
      },
    },
  ];
  const result = applyPaymentObservationRead(value, read(), context);
  assert({
    given: 'an exact owned unresolved payment and unrelated rereads',
    should: 'retain honest unknown facts and refuse all foreign identities',
    actual: [
      result.kind,
      result.kind === 'recorded' && result.observation.state,
      variants.map((v) => applyPaymentObservationRead(value, v, context).kind),
    ],
    expected: ['recorded', value.state, variants.map(() => 'refuse')],
  });
});

test('full payment and chronology proof share original-source and conflict policy', () => {
  const value = observation();
  const full = applyPaymentObservationRead(
    value,
    { ...read(), evidence: { kind: 'verified', payment: proof } },
    context,
  );
  const pre = applyPaymentObservationRead(
    value,
    {
      ...read(),
      evidence: {
        kind: 'chronology',
        proof: chronologyProof(proof.paidAtSeconds - 3),
        facts: {
          ...unknownPaymentFacts(),
          status: 'paid',
          paidAtSeconds: proof.paidAtSeconds - 3,
        },
      },
    },
    context,
  );
  const conflict =
    full.kind === 'recorded'
      ? applyPaymentObservationRead(
          full.observation,
          {
            ...read(),
            evidence: {
              kind: 'verified',
              payment: { ...proof, amountMinor: 999 },
            },
          },
          context,
        )
      : full;
  assert({
    given:
      'complete post-closure money proof, safely pre-closure chronology and a contradictory later allocation',
    should:
      'classify through the existing policy without granting money authority or erasing original facts',
    actual: [
      full.kind === 'recorded' && full.observation.state.kind,
      pre.kind === 'recorded' && pre.observation.state.kind,
      conflict.kind === 'recorded' && conflict.observation.state,
    ],
    expected: [
      'owed',
      'resolved',
      {
        kind: 'owed' as const,
        reason: 'conflicting_evidence' as const,
        evidence: { kind: 'verified' as const, payment: proof },
      },
    ],
  });
});

test('typed final refund conflict preserves this observation evidence and any already-bound identity without inheriting money authority', () => {
  const value = observation();
  const full = applyPaymentObservationRead(
    value,
    { ...read(), evidence: { kind: 'verified', payment: proof } },
    context,
  );
  if (full.kind !== 'recorded' || full.observation.kind !== 'payment')
    throw Error('Expected verified owned fixture');
  const bound = applyPaymentObservationRead(
    full.observation,
    { ...read(), evidence: { kind: 'verified', payment: proof } },
    context,
    originalAction(),
  );
  if (bound.kind !== 'recorded' || bound.observation.kind !== 'payment')
    throw Error('Expected bound original action fixture');
  const results = [full.observation, bound.observation].map((value) =>
    retainRefundAdmissionConflict(value, context),
  );
  assert({
    given:
      'positively retained exact owned payments with and without an already-bound original action',
    should:
      'keep original verified facts as sticky owed and preserve existing link without inheriting any foreign action or refund permission',
    actual: results.map(
      (result) => result.kind === 'recorded' && result.observation,
    ),
    expected: [full.observation, bound.observation].map((value) => ({
      ...value,
      state: {
        kind: 'owed' as const,
        reason: 'conflicting_evidence' as const,
        evidence: { kind: 'verified' as const, payment: proof },
      },
    })),
  });
});
