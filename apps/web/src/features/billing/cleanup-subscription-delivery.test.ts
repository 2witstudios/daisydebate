import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createCleanupSubscriptionDelivery } from './cleanup-subscription-delivery';
import {
  identity,
  subscription,
} from './subscription-observation.test-support';
setupRitewayBun();
type Input = Parameters<typeof createCleanupSubscriptionDelivery>[0];
const original: Extract<
  Awaited<ReturnType<Input['store']['frozenOffer']>>,
  { kind: 'owned' }
> = {
  kind: 'owned',
  owner: {
    mode: identity.mode,
    customerId: identity.customerId,
    priceId: identity.priceId,
    vendorSubscriptionId: identity.vendorSubscriptionId,
  },
  source: {
    kind: 'purchase',
    purchaseId: 'p'.repeat(24),
    vendorSubscriptionId: identity.vendorSubscriptionId,
    priceId: identity.priceId,
    admittedAt: '2026-11-01T00:00:00.000Z',
  },
};
const request: Parameters<
  ReturnType<typeof createCleanupSubscriptionDelivery>
>[0] = {
  jobId: 'j'.repeat(24),
  claimId: 'c'.repeat(24),
  retryAt: '2026-11-06T00:01:00.000Z',
  work: {
    kind: 'scan',
    lane: 'subscriptions',
    scan: {
      kind: 'selected',
      id: identity.vendorSubscriptionId,
      rest: [],
      lastId: identity.vendorSubscriptionId,
      more: false,
      detail: { kind: 'resource' },
    },
  },
};

test('lost cancellation replies recover by retrieving the original owned subscription, never by a new money action', async () => {
  let canceled = false,
    cancels = 0;
  const calls: unknown[] = [],
    events: unknown[] = [];
  const delivery = createCleanupSubscriptionDelivery({
    mode: 'test',
    running: () => true,
    store: {
      frozenOffer: async () => original,
      record: async (_job, event) => {
        events.push(event.kind);
        return event.kind === 'failure' ? 'failure' : 'progress';
      },
    },
    port: {
      subscription: async (id) => {
        calls.push(['read', id]);
        return { ...subscription, status: canceled ? 'canceled' : 'active' };
      },
      cancelSubscription: async (id) => {
        calls.push(['cancel', id]);
        cancels++;
        canceled = true;
        throw Error('Controlled lost response');
      },
    },
  });
  assert({
    given:
      'a cancellation that executed but returned an unknown reply and a later current retry',
    should:
      'keep the first obligation owed and retrieve the exact original identity before accepting its positive canceled state',
    actual: [
      await delivery(request),
      await delivery({ ...request, claimId: 'd'.repeat(24) }),
      cancels,
      calls,
      events,
    ],
    expected: [
      'failure',
      'progress',
      1,
      [
        ['read', identity.vendorSubscriptionId],
        ['cancel', identity.vendorSubscriptionId],
        ['read', identity.vendorSubscriptionId],
      ],
      ['failure', 'resolved'],
    ],
  });
});

test('fresh authority and exact frozen offer are required before the cancellation effect', async () => {
  const actual = [];
  for (const variant of ['expired', 'foreign', 'mode'] as const) {
    let checks = 0,
      cancels = 0,
      reads = 0;
    const events: unknown[] = [];
    const delivery = createCleanupSubscriptionDelivery({
      mode: variant === 'mode' ? 'live' : 'test',
      running: () => true,
      store: {
        frozenOffer: async () =>
          ++checks === 2 ? { kind: 'unresolved' } : original,
        record: async (_job, event) => {
          events.push(event.kind);
          return 'idle';
        },
      },
      port: {
        subscription: async () => {
          reads++;
          return variant === 'foreign'
            ? { ...subscription, customer: 'cus_foreign' }
            : subscription;
        },
        cancelSubscription: async () => {
          cancels++;
          return { ...subscription, status: 'canceled' };
        },
      },
    });
    actual.push([variant, await delivery(request), reads, cancels, events]);
  }
  assert({
    given:
      'claim expiry between read and effect, a foreign vendor object or unavailable original transport mode',
    should:
      'supply no cancellation authority and let the current database fence refuse stale retry writes',
    actual,
    expected: [
      ['expired', 'idle', 1, 0, ['failure']],
      ['foreign', 'idle', 1, 0, ['failure']],
      ['mode', 'idle', 0, 0, ['failure']],
    ],
  });
});

test('database failures do not become vendor backoff and shutdown admits no follow-up cancellation', async () => {
  const problem = Error('Controlled database failure');
  let checks = 0,
    retries = 0,
    cancels = 0;
  const delivery = createCleanupSubscriptionDelivery({
    mode: 'test',
    running: () => true,
    store: {
      frozenOffer: async () => {
        if (++checks === 2) throw problem;
        return original;
      },
      record: async () => {
        retries++;
        return 'failure';
      },
    },
    port: {
      subscription: async () => subscription,
      cancelSubscription: async () => {
        cancels++;
        return subscription;
      },
    },
  });
  let propagated = false;
  try {
    await delivery(request);
  } catch (error) {
    propagated = error === problem;
  }
  let running = true;
  const stopped = createCleanupSubscriptionDelivery({
    mode: 'test',
    running: () => running,
    store: {
      frozenOffer: async () => original,
      record: async () => {
        retries++;
        return 'progress';
      },
    },
    port: {
      subscription: async () => {
        running = false;
        return subscription;
      },
      cancelSubscription: async () => {
        cancels++;
        return subscription;
      },
    },
  });
  assert({
    given:
      'a current database authority read fails, or shutdown occurs while the vendor read is in flight',
    should:
      'propagate the database failure and stop every later effect/retry mutation',
    actual: [propagated, await stopped(request), retries, cancels],
    expected: [true, 'idle', 0, 0],
  });
});
