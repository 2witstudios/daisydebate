import { assert } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { cleanupWork, type CleanupState } from '@daisy/protocol/billing';
import type { cleanupCandidate } from './billing-cleanup-candidate.test-support';
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
  const paymentCursor = `inpay_${createId()}`;
  await apply({
    kind: 'payments',
    claimId: token(c),
    work: cleanupWork(c)!,
    beforeId: null,
    afterId: paymentCursor,
    exhausted: false,
  });
  c = await claim();
  if (c.kind !== 'scanning' || c.scans.invoices.kind !== 'selected')
    throw Error('Invoice fixture missing');
  const partial = c.scans.invoices;
  const reset = {
    ...c,
    claim: null,
    retryAt: new Date(Date.parse(await now()) + 1000).toISOString(),
    scans: {
      ...c.scans,
      invoices: {
        ...partial,
        detail: { kind: 'invoice-payments' as const, afterId: null },
      },
    },
  };
  const skipInvoice = {
    ...reset,
    scans: { ...reset.scans, invoices: { kind: 'complete' as const } },
  };
  assert({
    given:
      'an invoice with observed payment cursor and another retained invoice',
    should:
      'reject reset and skipping the selected remainder under the real runtime role',
    actual: [
      await probe(() => persist(reset, 'progress')),
      await probe(() => persist(skipInvoice, 'progress')),
    ],
    expected: ['23514', '23514'],
  });
  await apply({
    kind: 'payments',
    claimId: token(c),
    work: cleanupWork(c)!,
    beforeId: paymentCursor,
    afterId: null,
    exhausted: true,
  });
  const nextInvoice = await state();
  assert({
    given: 'exhausted payment scan for the first invoice',
    should:
      'select exactly the retained next invoice with a fresh payment cursor',
    actual: nextInvoice.kind === 'scanning' && nextInvoice.scans.invoices,
    expected: {
      kind: 'selected',
      id: invoiceB,
      rest: [],
      lastId: invoiceB,
      more: false,
      detail: { kind: 'invoice-payments', afterId: null },
    },
  });
  c = await claim();
  await apply({
    kind: 'payments',
    claimId: token(c),
    work: cleanupWork(c)!,
    beforeId: null,
    afterId: null,
    exhausted: true,
  });
  assert({
    given: 'exhausted final invoice and all other completed lanes',
    should: 'advance to deletion without dropping payment remainder',
    actual: (await state()).kind,
    expected: 'deleting',
  });
}
