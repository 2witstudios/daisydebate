import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  advanceCleanup,
  startCleanup,
  cleanupWork,
} from '@daisy/protocol/billing';
import { createBillingCleanupDelivery } from './cleanup-delivery';
setupRitewayBun();
type Input = Parameters<typeof createBillingCleanupDelivery>[0];
const now = '2026-11-06T00:00:00.000Z',
  jobId = 'j'.repeat(24),
  claimId = 'c'.repeat(24);
const empty = {
  mappedCustomers: 0,
  possiblePurchases: 0,
  retainedFinancialRoutes: 0,
  owedFinancialEffects: false,
};
function claimed(
  effects = empty,
  attempts = 0,
): Extract<Awaited<ReturnType<Input['store']['claim']>>, { kind: 'claimed' }> {
  const state = startCleanup(jobId, now);
  if (!state) throw Error('Missing fixture state');
  const result = advanceCleanup(
    state,
    { kind: 'claim', claimId },
    { jobId, now, closed: true },
  );
  if (result.kind !== 'claimed') throw Error('Missing current fixture claim');
  return {
    kind: 'claimed',
    state: result.state,
    work: cleanupWork(result.state)!,
    userId: 'u'.repeat(24),
    closedAt: '2026-11-05T00:00:00.000Z',
    attempts,
    facts: { route: { kind: 'absent' }, effects },
  };
}
const unexpected = async () => {
  throw Error('Unexpected store work');
};
function store(): Input['store'] {
  return {
    claim: unexpected,
    inspect: unexpected,
    resources: unexpected,
    record: unexpected,
    frozenOffer: unexpected,
    retainInvoiceIdentity: unexpected,
    recordInvoices: unexpected,
    retainInvoicePage: unexpected,
    deferInvoicePage: unexpected,
    invoicePassStep: unexpected,
    selectedObservation: unexpected,
    retainObservation: unexpected,
    recordPayments: unexpected,
    observations: unexpected,
    revisitPayment: unexpected,
    recordPayment: unexpected,
  };
}

test('free closed account completion works without Stripe keys and uses final current store authority', async () => {
  const events: unknown[] = [],
    retry: unknown[] = [];
  let result: 'complete' | 'idle' = 'complete';
  const delivery = createBillingCleanupDelivery({
    vendor: null,
    nextId: () => 'n'.repeat(24),
    retryAt: (at, attempts) => {
      retry.push([at, attempts]);
      return '2026-11-06T00:01:00.000Z';
    },
    store: {
      ...store(),
      claim: async () => claimed(empty, 2),
      record: async (_id, event) => {
        events.push(event);
        return result;
      },
    },
  });
  const first = await delivery.deliver(jobId);
  result = 'idle';
  const stale = await delivery.deliver(jobId);
  assert({
    given:
      'a no-Stripe free closure and separately a stale zero-effects projection rejected at final admission',
    should:
      'complete only the positively fenced first case and never infer success from the projection or cached attempts',
    actual: [first, stale, retry, events],
    expected: [
      'complete',
      'idle',
      [
        [now, 2],
        [now, 2],
      ],
      [
        { kind: 'no-effects', claimId, work: claimed().work },
        { kind: 'no-effects', claimId, work: claimed().work },
      ],
    ],
  });
});
test('one account advances one local bounded page without turning partial progress into generic success', async () => {
  let reads = 0,
    records = 0;
  const delivery = createBillingCleanupDelivery({
    vendor: null,
    nextId: () => 'n'.repeat(24),
    retryAt: () => '2026-11-06T00:01:00.000Z',
    store: {
      ...store(),
      claim: async () => claimed({ ...empty, retainedFinancialRoutes: 1 }),
      resources: async () => {
        reads++;
        return { kind: 'page', ids: [], more: false };
      },
      record: async () => {
        records++;
        return 'progress';
      },
    },
  });
  assert({
    given:
      'retained financial routing with one current local purchase page and no vendor keys',
    should:
      'yield durable partial progress after exactly one step rather than loop or acknowledge cleanup',
    actual: [await delivery.deliver(jobId), reads, records],
    expected: ['progress', 1, 1],
  });
});
test('shutdown while claim admission is in flight admits no later resource or queue mutation', async () => {
  let later = 0;
  const delivery = createBillingCleanupDelivery({
    vendor: null,
    nextId: () => 'n'.repeat(24),
    retryAt: () => '2026-11-06T00:01:00.000Z',
    store: {
      ...store(),
      claim: async () => {
        delivery.stop();
        return claimed();
      },
      record: async () => {
        later++;
        return 'complete';
      },
    },
  });
  assert({
    given: 'stop wins while an already admitted claim reply is pending',
    should:
      'leave the honest claimed outcome recoverable and admit no follow-up work',
    actual: [
      await delivery.deliver(jobId),
      await delivery.deliver(jobId),
      later,
    ],
    expected: ['idle', 'idle', 0],
  });
});
