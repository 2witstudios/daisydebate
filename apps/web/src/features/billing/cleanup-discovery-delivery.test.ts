import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ownedInvoiceObservationSchema } from '@daisy/protocol/billing';
import { createCleanupDiscoveryDelivery } from './cleanup-discovery-delivery';
setupRitewayBun();
type Input = Parameters<typeof createCleanupDiscoveryDelivery>[0];
const read = ownedInvoiceObservationSchema.parse({
  mode: 'test',
  customerId: 'cus_owned',
  invoiceId: 'in_owned',
  source: { kind: 'unresolved', vendorSubscriptionId: null, priceId: null },
});
const current: Extract<
  Awaited<ReturnType<Input['store']['inspect']>>,
  { kind: 'current' }
> = {
  kind: 'current',
  userId: 'u'.repeat(24),
  closedAt: '2026-11-05T00:00:00.000Z',
  now: '2026-11-06T00:00:00.000Z',
  attempts: 0,
  facts: {
    route: { kind: 'owned', mode: 'test', customerId: 'cus_owned' },
    effects: {
      mappedCustomers: 1,
      possiblePurchases: 0,
      retainedFinancialRoutes: 0,
      owedFinancialEffects: false,
    },
  },
};
const request: Parameters<
  ReturnType<typeof createCleanupDiscoveryDelivery>
>[0] = {
  jobId: 'j'.repeat(24),
  claimId: 'c'.repeat(24),
  retryAt: '2026-11-06T00:01:00.000Z',
  work: {
    kind: 'scan',
    lane: 'invoices',
    scan: { kind: 'page', afterId: null },
  },
};
const unexpected = async () => {
  throw Error('Unexpected store path');
};
const store = (): Input['store'] => ({
  inspect: async () => current,
  record: unexpected,
  retainInvoicePage: unexpected,
  deferInvoicePage: unexpected,
  recordInvoices: unexpected,
});

test('incomplete invoice pages retain exact positive knowledge with failure/backoff and no cursor progress', async () => {
  const calls: unknown[] = [];
  const deliver = createCleanupDiscoveryDelivery({
    running: () => true,
    read: async () => ({ kind: 'invoice-reads', reads: [read] }),
    store: {
      ...store(),
      deferInvoicePage: async (...args) => {
        calls.push(args);
        return 'failure';
      },
    },
  });
  assert({
    given: 'a mixed producer page with one positively owned invoice',
    should:
      'atomically retain that identity while keeping page traversal unchanged and recording one ordinary failure',
    actual: [await deliver(request), calls],
    expected: [
      'failure',
      [
        [
          request.jobId,
          request.claimId,
          request.work,
          { reads: [read], retryAt: request.retryAt },
        ],
      ],
    ],
  });
});
test('rotated-job discovery records newly owned invoice facts through current account authority without old cursor authority', async () => {
  const calls: unknown[] = [];
  let attempts = 0;
  const deliver = createCleanupDiscoveryDelivery({
    running: () => true,
    read: async () => ({ kind: 'invoice-page', reads: [read], more: false }),
    store: {
      ...store(),
      retainInvoicePage: async () => {
        calls.push('old-cursor-idle');
        return 'idle';
      },
      recordInvoices: async (...args) => {
        calls.push(args);
        return ++attempts === 1 ? 'recorded' : 'unchanged';
      },
    },
  });
  assert({
    given:
      'actual positive invoice identities after the original cursor claim has become idle',
    should:
      'admit only account-fenced retained facts, reopen once and leave identical replay idle',
    actual: [await deliver(request), await deliver(request), calls],
    expected: [
      'reopened',
      'idle',
      [
        'old-cursor-idle',
        [current.userId, [read]],
        'old-cursor-idle',
        [current.userId, [read]],
      ],
    ],
  });
});
test('current authority refusal and vendor read failure keep their distinct idle and retry meanings', async () => {
  let reads = 0;
  const events: unknown[] = [];
  const stale = createCleanupDiscoveryDelivery({
    running: () => true,
    read: async () => {
      reads++;
      return { kind: 'unavailable' };
    },
    store: { ...store(), inspect: async () => ({ kind: 'refuse' }) },
  });
  const failed = createCleanupDiscoveryDelivery({
    running: () => true,
    read: async () => {
      reads++;
      return { kind: 'unavailable' };
    },
    store: {
      ...store(),
      record: async (_id, event) => {
        events.push(event);
        return 'failure';
      },
    },
  });
  assert({
    given: 'a stale claim and separately a current but unavailable vendor page',
    should:
      'perform no stale read/write and consume only the current failure claim',
    actual: [await stale(request), await failed(request), reads, events],
    expected: [
      'idle',
      'failure',
      1,
      [
        {
          kind: 'failure',
          claimId: request.claimId,
          work: request.work,
          retryAt: request.retryAt,
        },
      ],
    ],
  });
});
test('database failures and shutdown cannot become late-fact fallbacks', async () => {
  const problem = Error('Controlled database failure');
  let lateWrites = 0,
    running = true;
  const failed = createCleanupDiscoveryDelivery({
    running: () => true,
    read: async () => ({ kind: 'invoice-page', reads: [read], more: false }),
    store: {
      ...store(),
      retainInvoicePage: async () => {
        throw problem;
      },
      recordInvoices: async () => {
        lateWrites++;
        return 'recorded';
      },
    },
  });
  let propagated = false;
  try {
    await failed(request);
  } catch (error) {
    propagated = error === problem;
  }
  const stopped = createCleanupDiscoveryDelivery({
    running: () => running,
    read: async () => ({ kind: 'invoice-page', reads: [read], more: false }),
    store: {
      ...store(),
      retainInvoicePage: async () => {
        running = false;
        return 'idle';
      },
      recordInvoices: async () => {
        lateWrites++;
        return 'recorded';
      },
    },
  });
  assert({
    given:
      'a DB admission failure or shutdown while old cursor admission was in flight',
    should:
      'propagate real DB errors and admit no follow-up late write after stop',
    actual: [propagated, await stopped(request), lateWrites],
    expected: [true, 'idle', 0],
  });
});
