import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  billingCleanupSchema,
  cleanupWork,
  startCleanup,
} from './billing-cleanup';
import { advanceCleanup } from './billing-cleanup-lifecycle';
import {
  at,
  job,
  first,
  claimed,
  context,
} from './billing-cleanup.test-support';
import { billingPaymentObservationSchema } from './billing-payment-observation';
import { owner } from './billing-payment-observation.test-support';

setupRitewayBun();
const initial = () =>
  billingCleanupSchema.parse({
    ...startCleanup(job, at(0)),
    turn: 'observations',
    invoiceDebt: {
      kind: 'owed',
      ids: [owner.invoiceId, 'in_unroutedLater'],
      next: 'identity',
    },
  });
test('unknown identity failure keeps its debt and all financial traversal frames while yielding fairly', () => {
  const state = claimed(initial(), 10);
  if (state.kind !== 'scanning') throw Error('Expected current identity scan');
  const event = {
    kind: 'failure' as const,
    claimId: first,
    work: cleanupWork(state)!,
    retryAt: at(12),
  };
  const result = advanceCleanup(state, event, context(10.1));
  assert({
    given: 'a live exact identity claim whose original route cannot be proven',
    should:
      'record one failure, preserve frames/debt and yield to purchase discovery without refreshing authority',
    actual: result.kind !== 'idle' &&
      result.state.kind === 'scanning' && [
        result.kind,
        result.state.turn,
        result.state.invoiceDebt,
        result.state.scans,
        result.state.claim,
        advanceCleanup(result.state, event, context(10.2)),
      ],
    expected: [
      'failure',
      'purchases',
      {
        kind: 'owed',
        ids: ['in_unroutedLater', owner.invoiceId],
        next: 'observations',
      },
      state.scans,
      null,
      { kind: 'idle' },
    ],
  });
});
test('missing route debt defeats both completion projections even when other stored effects are absent', () => {
  const state = claimed(initial(), 10);
  const authority = {
    ...context(10.1),
    effects: {
      mappedCustomers: 0,
      possiblePurchases: 0,
      retainedFinancialRoutes: 0,
      owedFinancialEffects: false,
    },
  };
  assert({
    given:
      'unrouted positive invoice identities and no mapped or retained financial rows',
    should:
      'refuse both missing-effects acknowledgement and alleged deletion without dropping debt',
    actual: ['no-effects', 'deleted'].map((kind) =>
      advanceCleanup(
        state,
        {
          kind: kind as 'no-effects' | 'deleted',
          claimId: first,
          work: cleanupWork(state)!,
        },
        authority,
      ),
    ),
    expected: [{ kind: 'idle' }, { kind: 'idle' }],
  });
});
test('positive exact owned witness retires only one identity after retention; foreign or resolved history cannot', () => {
  const state = claimed(initial(), 10);
  const observation = billingPaymentObservationSchema.parse({
    ...owner,
    kind: 'invoice',
    state: { kind: 'owed', reason: 'enumeration_unavailable' },
  });
  const authority = {
    ...context(10.1),
    observationOwner: { userId: owner.userId, closedAt: owner.closedAt },
  };
  const event = {
    kind: 'invoice-identity-retained' as const,
    claimId: first,
    work: cleanupWork(state)!,
    observation,
  };
  const result = advanceCleanup(state, event, authority);
  assert({
    given:
      'one newly durable exact owned invoice witness with no enumeration or payment settlement authority',
    should:
      'consume only its identity debt/current claim, preserve financial facts and refuse foreign ownership',
    actual: [
      result.kind !== 'idle' &&
        result.state.kind === 'scanning' && [
          result.kind,
          result.state.invoiceDebt,
          result.state.turn,
          result.state.claim,
        ],
      advanceCleanup(
        state,
        { ...event, observation: { ...observation, userId: 'f'.repeat(24) } },
        authority,
      ),
      observation.state,
    ],
    expected: [
      [
        'progress',
        { kind: 'owed', ids: ['in_unroutedLater'], next: 'observations' },
        'purchases',
        null,
      ],
      { kind: 'idle' },
      { kind: 'owed', reason: 'enumeration_unavailable' },
    ],
  });
});

test('identity claims cannot be consumed as page exhaustion or generic resource resolution', () => {
  const state = claimed(initial(), 10);
  const work = cleanupWork(state)!;
  assert({
    given:
      'an unresolved identity claim sharing the observations turn with a normal head scan',
    should:
      'refuse page/resolution outcomes instead of advancing unrelated observation traversal',
    actual: [
      advanceCleanup(
        state,
        { kind: 'page', claimId: first, work, ids: [], more: false },
        context(10.1),
      ),
      advanceCleanup(
        state,
        { kind: 'resolved', claimId: first, work },
        context(10.1),
      ),
    ],
    expected: [{ kind: 'idle' }, { kind: 'idle' }],
  });
});

test('discovery exhaustion with identity debt restarts all heads rather than trapping work in the observations lane', () => {
  const source = billingCleanupSchema.parse({
    ...initial(),
    invoiceDebt: { kind: 'owed', ids: [owner.invoiceId], next: 'observations' },
    scans: {
      purchases: { kind: 'complete' },
      subscriptions: { kind: 'complete' },
      invoices: { kind: 'complete' },
      refunds: { kind: 'complete' },
      observations: { kind: 'page', afterId: null },
    },
  });
  const state = claimed(source, 10);
  const result = advanceCleanup(
    state,
    {
      kind: 'page',
      claimId: first,
      work: cleanupWork(state)!,
      ids: [],
      more: false,
    },
    {
      ...context(10.1),
      effects: {
        mappedCustomers: 0,
        possiblePurchases: 0,
        retainedFinancialRoutes: 0,
        owedFinancialEffects: false,
      },
    },
  );
  assert({
    given:
      'a last empty observation head while an unrouted invoice remains owed',
    should:
      'revisit purchase/cancellation/invoice/refund heads fairly without clearing identity debt or admitting deletion',
    actual: result.kind !== 'idle' &&
      result.state.kind === 'scanning' && [
        result.kind,
        result.state.turn,
        result.state.invoiceDebt,
        result.state.scans,
      ],
    expected: [
      'progress',
      'purchases',
      { kind: 'owed', ids: [owner.invoiceId], next: 'identity' },
      {
        purchases: { kind: 'page', afterId: null },
        subscriptions: { kind: 'page', afterId: null },
        invoices: { kind: 'page', afterId: null },
        refunds: { kind: 'page', afterId: null },
        observations: { kind: 'page', afterId: null },
      },
    ],
  });
});
