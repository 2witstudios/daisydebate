import { assert } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import {
  cleanupWork,
  billingPaymentObservationSchema,
  type CleanupState,
} from '@daisy/protocol/billing';
import type { cleanupCandidate } from './billing-cleanup-candidate.test-support';
import { claimTarget } from './billing-invoice-pass-role.test-support';
export async function exerciseInvoiceProgress(
  matrix: ReturnType<typeof cleanupCandidate>,
) {
  const { claim, apply, token, state, now, probe, persist } = matrix;
  let c: CleanupState;
  for (let lane = 0; lane < 2; lane++) {
    c = await claim();
    await apply({
      kind: 'page',
      claimId: token(c),
      work: cleanupWork(c)!,
      ids: [],
      more: false,
    });
  }
  c = await claim();
  const invoiceA = `in_${createId()}`,
    invoiceB = `in_${createId()}`;
  await matrix.retainInvoice(invoiceA);
  await matrix.retainInvoice(invoiceB);
  await apply({
    kind: 'page',
    claimId: token(c),
    work: cleanupWork(c)!,
    ids: [invoiceA, invoiceB],
    more: false,
  });
  c = await claim();
  await apply({
    kind: 'page',
    claimId: token(c),
    work: cleanupWork(c)!,
    ids: [],
    more: false,
  });
  c = await claim();
  await apply({
    kind: 'page',
    claimId: token(c),
    work: cleanupWork(c)!,
    ids: await matrix.observationIds(),
    more: false,
  });
  c = await claim();
  const paymentCursor = `inpay_${createId()}`;
  const retained = await matrix.retainInvoice(invoiceA);
  const witness = retained.invoice;
  const owner = {
    userId: witness.userId,
    closedAt: witness.closedAt,
    mode: witness.mode,
    customerId: witness.customerId,
    invoiceId: invoiceA,
    source: witness.source,
    period: null,
  };
  await matrix.applyInvoice(
    { kind: 'start', passId: createId(), owner },
    witness,
  );
  c = (await claimTarget(matrix, 'invoices', invoiceA)).state;
  const read = {
    mode: witness.mode,
    customerId: witness.customerId,
    invoiceId: invoiceA,
    invoicePaymentId: paymentCursor,
    source: witness.source,
    evidence: {
      kind: 'partial' as const,
      facts: {
        status: null,
        paidAtSeconds: null,
        amountPaidMinor: null,
        charge: { kind: 'unresolved' as const },
        period: null,
      },
    },
  };
  const fake = billingPaymentObservationSchema.parse({
    ...witness,
    id: createId(),
    kind: 'payment',
    invoicePaymentId: paymentCursor,
    refundActionId: null,
    state: {
      kind: 'owed',
      reason: 'payment_unresolved',
      evidence: read.evidence,
    },
  });
  const step = {
    kind: 'advance' as const,
    event: {
      kind: 'retained' as const,
      beforeId: null,
      read,
      observation: fake,
      more: true,
    },
  };
  assert({
    given:
      'a current selected invoice pass and an unpersisted payment identity',
    should: 'reject pass movement before durable payment retention',
    actual: await probe(() => matrix.applyInvoice(step, witness)),
    expected: '23514',
  });
  const actual = await matrix.retainInvoice(invoiceA, paymentCursor);
  if (!actual.payment) throw Error('Missing controlled payment witness');
  await matrix.applyInvoice(
    { ...step, event: { ...step.event, observation: actual.payment } },
    actual.invoice,
  );
  c = (await claimTarget(matrix, 'invoices', invoiceA)).state;
  const { selected: partial, state: active } = claimedInvoicePass(c);
  const reset = {
    ...active,
    claim: null,
    retryAt: new Date(Date.parse(await now()) + 1000).toISOString(),
    scans: {
      ...active.scans,
      invoices: {
        ...partial,
        detail: { kind: 'invoice-payments' as const, pass: null },
      },
    },
  };
  const skip = {
    ...reset,
    scans: { ...reset.scans, invoices: { kind: 'complete' as const } },
  };
  assert({
    given: 'one retained payment and a selected later invoice remainder',
    should: 'refuse pass reset and skipped remainder',
    actual: [
      await probe(() => persist(reset, 'progress')),
      await probe(() => persist(skip, 'progress')),
    ],
    expected: ['23514', '23514'],
  });
  await matrix.applyInvoice(
    { kind: 'advance', event: { kind: 'exhausted', beforeId: paymentCursor } },
    actual.invoice,
  );
  c = (await claimTarget(matrix, 'invoices', invoiceA)).state;
  const { pass, claim: currentClaim } = claimedInvoicePass(c);
  const at = await now();
  await matrix.applyInvoice(
    {
      kind: 'advance',
      event: {
        kind: 'head',
        receipt: {
          kind: 'head',
          passId: pass.id,
          jobId: pass.jobId,
          claimId: currentClaim.id,
          startedAt: currentClaim.claimedAt,
          observedAt: at,
          owner,
          request: { invoiceId: invoiceA, limit: 20 },
          hasMore: false,
          reads: [read],
        },
        retained: [actual.payment],
      },
    },
    actual.invoice,
  );
  const nextInvoice = await state();
  assert({
    given:
      'a complete controlled membership response but unknown original source/period',
    should:
      'retain owed facts and advance exactly one invoice remainder without claiming coverage',
    actual: nextInvoice.kind === 'scanning' && nextInvoice.scans.invoices,
    expected: {
      kind: 'selected',
      id: invoiceB,
      rest: [],
      lastId: invoiceB,
      more: false,
      detail: { kind: 'invoice-payments', pass: null },
    },
  });
  c = (await claimTarget(matrix, 'invoices', invoiceB)).state;
  const last = await matrix.retainInvoice(invoiceB);
  await apply({
    kind: 'retained',
    claimId: token(c),
    work: cleanupWork(c)!,
    observation: last.invoice,
  });
  assert({
    given: 'the last invoice has an honestly retained unresolved witness',
    should: 'restart discovery with all financial obligations owed',
    actual: [
      (await state()).kind,
      (await state()).kind === 'scanning' && 'turn' in (await state()),
    ],
    expected: ['scanning', true],
  });
}

function claimedInvoicePass(state: CleanupState) {
  if (
    state.kind !== 'scanning' ||
    state.scans.invoices.kind !== 'selected' ||
    state.scans.invoices.detail.kind !== 'invoice-payments' ||
    !state.scans.invoices.detail.pass ||
    !state.claim
  )
    throw Error('Missing current invoice pass');
  return {
    state,
    selected: state.scans.invoices,
    pass: state.scans.invoices.detail.pass,
    claim: state.claim,
  };
}
