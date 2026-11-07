import { assert, setupRitewayBun, test } from 'riteway/bun';
import { advanceCleanupInvoicePass } from './billing-cleanup-invoice-pass';
import {
  billingCleanupSchema,
  cleanupWork,
  startCleanup,
  type CleanupState,
} from './billing-cleanup';
import { owner, authority, witness } from './billing-invoice-pass.test-support';
setupRitewayBun();
function selected() {
  const ctx = authority();
  const value = startCleanup(ctx.jobId, ctx.claim.claimedAt);
  if (value?.kind !== 'scanning') throw Error('Expected scanning');
  return billingCleanupSchema.parse({
    ...value,
    turn: 'invoices',
    claim: ctx.claim,
    scans: {
      ...value.scans,
      invoices: {
        kind: 'selected',
        id: owner.invoiceId,
        rest: ['in_later'],
        lastId: 'in_later',
        more: false,
        detail: { kind: 'invoice-payments', pass: null },
      },
    },
  });
}
function context() {
  return {
    now: authority().now,
    jobId: authority().jobId,
    closed: true,
    observationOwner: { userId: owner.userId, closedAt: owner.closedAt },
    effects: {
      mappedCustomers: 1,
      possiblePurchases: 1,
      retainedFinancialRoutes: 1,
      owedFinancialEffects: true,
    },
  };
}
function request(value: CleanupState) {
  return {
    claimId: authority().claim.id,
    work: cleanupWork(value)!,
    step: { kind: 'start' as const, passId: 'i'.repeat(24), owner },
    witness: witness(authority()),
  };
}
test('a current selected invoice starts fresh authority while preserving its exact remainder and consuming one claim', () => {
  const value = selected(),
    result = advanceCleanupInvoicePass(value, request(value), context());
  assert({
    given: 'selected invoice and current canonical owner/job/claim',
    should:
      'start an empty fresh pass and preserve selected page/remainder without covering enumeration',
    actual: result.kind === 'progress' &&
      result.state.kind === 'scanning' && [
        result.state.scans.invoices,
        result.state.claim,
      ],
    expected: [
      {
        kind: 'selected',
        id: owner.invoiceId,
        rest: ['in_later'],
        lastId: 'in_later',
        more: false,
        detail: {
          kind: 'invoice-payments',
          pass: {
            id: 'i'.repeat(24),
            jobId: authority().jobId,
            beganAt: authority().now,
            owner,
            phase: 'retaining',
            afterId: null,
            comparison: { kind: 'bounded', reads: [] },
          },
        },
      },
      null,
    ],
  });
});
test('foreign witness, expired claim, wrong selected work and prior pass cannot replace current execution authority', () => {
  const value = selected(),
    input = request(value),
    ctx = context();
  const started = advanceCleanupInvoicePass(value, input, ctx);
  if (started.kind !== 'progress' || started.state.kind !== 'scanning')
    throw Error('Expected progress');
  const current = {
    ...started.state,
    turn: 'invoices' as const,
    claim: authority().claim,
  };
  const variants = [
    advanceCleanupInvoicePass(
      value,
      { ...input, witness: { ...input.witness, userId: 'x'.repeat(24) } },
      ctx,
    ),
    advanceCleanupInvoicePass(value, input, {
      ...ctx,
      now: authority().claim.expiresAt,
    }),
    advanceCleanupInvoicePass(
      value,
      { ...input, work: { kind: 'delete' } },
      ctx,
    ),
    advanceCleanupInvoicePass(
      current,
      { ...input, work: cleanupWork(current)! },
      ctx,
    ),
  ];
  assert({
    given: 'invalid current identity/claim/work or an already-started pass',
    should: 'refuse without claiming prior stored knowledge as fresh authority',
    actual: variants.map((v) => v.kind),
    expected: ['idle', 'idle', 'idle', 'idle'],
  });
});

test('recognized owned source contradiction at pass start advances retained owed work without creating contradictory pass authority', () => {
  const value = selected(),
    input = request(value);
  const result = advanceCleanupInvoicePass(
    value,
    {
      ...input,
      step: {
        ...input.step,
        owner: {
          ...owner,
          source: {
            kind: 'unresolved',
            vendorSubscriptionId: owner.source.vendorSubscriptionId,
            priceId: 'price_changed',
          },
        },
      },
      witness: {
        ...input.witness,
        state: { kind: 'owed', reason: 'conflicting_evidence' },
      },
    },
    context(),
  );
  assert({
    given:
      'a current exact invoice claim whose retained original source has a recognized contradiction',
    should:
      'preserve owed evidence and selected remainder rather than persisting an incompatible new pass',
    actual:
      result.kind === 'progress' &&
      result.state.kind === 'scanning' &&
      result.state.scans.invoices,
    expected: {
      kind: 'selected',
      id: 'in_later',
      rest: [],
      lastId: 'in_later',
      more: false,
      detail: { kind: 'invoice-payments', pass: null },
    },
  });
});

test('a stored contradiction cannot turn malformed new pass input into progress', () => {
  const value = selected(),
    input = request(value);
  const result = advanceCleanupInvoicePass(
    value,
    {
      ...input,
      step: {
        kind: 'start',
        passId: 'i'.repeat(24),
        owner: {
          ...owner,
          source: {
            kind: 'purchase',
            purchaseId: 'p'.repeat(24),
            priceId: 'price_owned',
            vendorSubscriptionId: 'sub_owned',
            admittedAt: 'invalid',
          },
        },
      },
      witness: {
        ...input.witness,
        state: { kind: 'owed', reason: 'conflicting_evidence' },
      },
    },
    context(),
  );
  assert({
    given:
      'an already sticky owed invoice and a malformed proposed original source',
    should:
      'validate the proposed transition before preserving a recognized contradiction',
    actual: result,
    expected: { kind: 'idle' },
  });
});
