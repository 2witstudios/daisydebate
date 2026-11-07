import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createCleanupCustomerDelivery } from './cleanup-customer-delivery';
setupRitewayBun();
type Input = Parameters<typeof createCleanupCustomerDelivery>[0];
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
      mappedCustomers: 0,
      possiblePurchases: 0,
      retainedFinancialRoutes: 1,
      owedFinancialEffects: false,
    },
  },
};
const request = {
  jobId: 'j'.repeat(24),
  claimId: 'c'.repeat(24),
  work: { kind: 'delete' },
  retryAt: '2026-11-06T00:01:00.000Z',
} as const;
const present = { object: 'customer', id: 'cus_owned', livemode: false },
  gone = { object: 'customer', id: 'cus_owned', deleted: true };

test('unknown customer-deletion outcome is recovered by exact original retrieval without another deletion', async () => {
  let deleted = false,
    deletes = 0;
  const calls: unknown[] = [],
    events: unknown[] = [];
  const deliver = createCleanupCustomerDelivery({
    mode: 'test',
    running: () => true,
    store: {
      inspect: async () => current,
      record: async (_id, event) => {
        events.push(event.kind);
        return event.kind === 'deleted' ? 'complete' : 'failure';
      },
    },
    port: {
      customer: async (id) => {
        calls.push(['read', id]);
        return deleted ? gone : present;
      },
      deleteCustomer: async (id) => {
        calls.push(['delete', id]);
        deletes++;
        deleted = true;
        throw Error('Controlled lost reply');
      },
    },
  });
  assert({
    given:
      'vendor deletion executed with a lost reply and minimal routing retained after mapping removal',
    should:
      'keep first result owed, retrieve the original identity on retry, and let only final fenced record acknowledge',
    actual: [
      await deliver(request),
      await deliver({ ...request, claimId: 'd'.repeat(24) }),
      deletes,
      calls,
      events,
    ],
    expected: [
      'failure',
      'complete',
      1,
      [
        ['read', 'cus_owned'],
        ['delete', 'cus_owned'],
        ['read', 'cus_owned'],
      ],
      ['failure', 'deleted'],
    ],
  });
});

test('current debt, stale job, unavailable mode and foreign customer replies never authorize deletion', async () => {
  const actual = [];
  for (const variant of ['owed', 'stale', 'mode', 'foreign'] as const) {
    let reads = 0,
      deletes = 0,
      mutations = 0;
    const delivery = createCleanupCustomerDelivery({
      mode: variant === 'mode' ? 'live' : 'test',
      running: () => true,
      store: {
        inspect: async () =>
          variant === 'stale'
            ? { kind: 'refuse' }
            : variant === 'owed'
              ? {
                  ...current,
                  facts: {
                    ...current.facts,
                    effects: {
                      ...current.facts.effects,
                      owedFinancialEffects: true,
                    },
                  },
                }
              : current,
        record: async () => {
          mutations++;
          return 'failure';
        },
      },
      port: {
        customer: async () => {
          reads++;
          return variant === 'foreign'
            ? { ...present, id: 'cus_foreign' }
            : present;
        },
        deleteCustomer: async () => {
          deletes++;
          return gone;
        },
      },
    });
    actual.push([variant, await delivery(request), reads, deletes, mutations]);
  }
  assert({
    given:
      'a current owed effect, stale authority, wrong configured transport mode or foreign vendor identity',
    should: 'admit no deletion and leave stale work fully idle',
    actual,
    expected: [
      ['owed', 'failure', 0, 0, 1],
      ['stale', 'idle', 0, 0, 0],
      ['mode', 'failure', 0, 0, 1],
      ['foreign', 'failure', 1, 0, 1],
    ],
  });
});

test('late debt and job rotation are rechecked after retrieval before a delete effect', async () => {
  const actual = [];
  for (const variant of ['owed', 'rotated'] as const) {
    let checks = 0,
      deletes = 0,
      mutations = 0;
    const delivery = createCleanupCustomerDelivery({
      mode: 'test',
      running: () => true,
      store: {
        inspect: async () =>
          ++checks === 1
            ? current
            : variant === 'rotated'
              ? { kind: 'refuse' }
              : {
                  ...current,
                  facts: {
                    ...current.facts,
                    effects: {
                      ...current.facts.effects,
                      owedFinancialEffects: true,
                    },
                  },
                },
        record: async () => {
          mutations++;
          return 'failure';
        },
      },
      port: {
        customer: async () => present,
        deleteCustomer: async () => {
          deletes++;
          return gone;
        },
      },
    });
    actual.push([variant, await delivery(request), checks, deletes, mutations]);
  }
  assert({
    given:
      'a late independent obligation or rotated job while the customer read is in flight',
    should: 'supply no new delete authority and mutate no replacement job',
    actual,
    expected: [
      ['owed', 'failure', 2, 0, 1],
      ['rotated', 'idle', 2, 0, 0],
    ],
  });
});

test('database failures propagate and shutdown does not admit follow-up deletion', async () => {
  const problem = Error('Controlled database failure');
  let checks = 0,
    writes = 0,
    deletes = 0;
  const delivery = createCleanupCustomerDelivery({
    mode: 'test',
    running: () => true,
    store: {
      inspect: async () => {
        if (++checks === 2) throw problem;
        return current;
      },
      record: async () => {
        writes++;
        return 'failure';
      },
    },
    port: {
      customer: async () => present,
      deleteCustomer: async () => {
        deletes++;
        return gone;
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
  const stopped = createCleanupCustomerDelivery({
    mode: 'test',
    running: () => running,
    store: {
      inspect: async () => current,
      record: async () => {
        writes++;
        return 'complete';
      },
    },
    port: {
      customer: async () => {
        running = false;
        return present;
      },
      deleteCustomer: async () => {
        deletes++;
        return gone;
      },
    },
  });
  assert({
    given:
      'post-read database authority fails or process shutdown wins while retrieving',
    should:
      'avoid vendor-failure reclassification, new effects and retry mutations',
    actual: [propagated, await stopped(request), writes, deletes],
    expected: [true, 'idle', 0, 0],
  });
});
