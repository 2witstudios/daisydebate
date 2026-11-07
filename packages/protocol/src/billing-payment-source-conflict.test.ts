import { assert, setupRitewayBun, test } from 'riteway/bun';
import { applyPaymentObservationRead } from './billing-payment-observation-read';
import { paymentObservationComplete } from './billing-payment-observation-policy';
import { unknownPaymentFacts } from './billing-payment-observation-facts';
import {
  observation,
  proof,
  context,
  chronologyProof,
} from './billing-payment-observation.test-support';
setupRitewayBun();
for (const variant of ['verified', 'chronology'] as const) {
  test(`${variant} source contradiction cannot discard already recognized sticky owed`, () => {
    const value = observation();
    const paidAtSeconds = proof.paidAtSeconds - 3;
    const read = {
      mode: proof.mode,
      customerId: proof.customerId,
      invoiceId: proof.invoiceId,
      invoicePaymentId: proof.invoicePaymentId,
      source: value.source,
      evidence: {
        kind: 'chronology',
        proof: chronologyProof(paidAtSeconds),
        facts: { ...unknownPaymentFacts(), status: 'paid', paidAtSeconds },
      },
    };
    const complete = applyPaymentObservationRead(value, read, context);
    if (
      complete.kind !== 'recorded' ||
      complete.observation.kind !== 'payment' ||
      complete.observation.state.kind !== 'resolved'
    )
      throw Error('Missing complete source A control');
    assert({
      given:
        'an exact owned payment positively proven before closure with original source A',
      should: 'start from complete knowledge',
      actual: paymentObservationComplete(complete.observation),
      expected: true,
    });
    const source = { ...value.source, priceId: 'price_other' };
    const evidence =
      variant === 'verified'
        ? {
            kind: 'verified',
            payment: { ...proof, paidAtSeconds, priceId: source.priceId },
          }
        : {
            kind: 'chronology',
            proof: {
              ...chronologyProof(paidAtSeconds),
              priceId: source.priceId,
            },
            facts: { ...unknownPaymentFacts(), status: 'paid', paidAtSeconds },
          };
    const result = applyPaymentObservationRead(
      complete.observation,
      { ...read, source, evidence },
      context,
    );
    assert({
      given: `the same exact identity with internally matching ${variant} proof and conflicting source B`,
      should:
        'retain original source/evidence as sticky owed instead of replacing the source decision with refusal',
      actual: result.kind === 'recorded' && result.observation,
      expected: {
        ...complete.observation,
        state: {
          kind: 'owed' as const,
          reason: 'conflicting_evidence' as const,
          evidence: complete.observation.state.evidence,
        },
      },
    });
  });
}

test('a source contradiction never turns foreign or incoherent proof or invalid context into recorded authority', () => {
  const value = observation();
  const source = { ...value.source, priceId: 'price_other' };
  const read = {
    mode: proof.mode,
    customerId: proof.customerId,
    invoiceId: proof.invoiceId,
    invoicePaymentId: proof.invoicePaymentId,
    source,
    evidence: {
      kind: 'verified',
      payment: { ...proof, priceId: source.priceId },
    },
  };
  const variants = [
    { ...read, invoicePaymentId: 'inpay_foreign' },
    { ...read, customerId: 'cus_foreign' },
    {
      ...read,
      evidence: {
        kind: 'verified',
        payment: { ...read.evidence.payment, invoiceId: 'in_foreign' },
      },
    },
    {
      ...read,
      evidence: {
        kind: 'verified',
        payment: { ...read.evidence.payment, mode: 'live' },
      },
    },
    {
      ...read,
      evidence: {
        kind: 'verified',
        payment: { ...read.evidence.payment, priceId: 'price_unrelated' },
      },
    },
    {
      ...read,
      evidence: {
        kind: 'chronology',
        proof: { ...chronologyProof(), priceId: source.priceId },
        facts: {
          ...unknownPaymentFacts(),
          status: 'open',
          paidAtSeconds: proof.paidAtSeconds,
        },
      },
    },
    { ...read, source: null },
  ];
  assert({
    given:
      'a conflicting source alongside foreign nested identity/offer, incoherent chronology or malformed input',
    should:
      'refuse instead of broadly converting downstream refusal into a source write',
    actual: [
      variants.map(
        (input) => applyPaymentObservationRead(value, input, context).kind,
      ),
      applyPaymentObservationRead(value, read, {
        ...context,
        userId: 'x'.repeat(24),
      }).kind,
    ],
    expected: [variants.map(() => 'refuse'), 'refuse'],
  });
});
