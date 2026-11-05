import { assert, setupRitewayBun, test } from 'riteway/bun';
import { isAppError } from '@daisy/errors';
import { createSubscriptionReconciliation } from './subscription-reconciliation';
import {
  identity,
  subscription,
  invoice,
} from './subscription-observation.test-support';

setupRitewayBun();
type Input = Parameters<typeof createSubscriptionReconciliation>[0];
const claim = {
  customerId: 'b'.repeat(24),
  userId: 'c'.repeat(24),
  vendorCustomerId: identity.customerId,
  mode: 'test' as const,
  subscriptionId: identity.subscriptionId,
  vendorSubscriptionId: identity.vendorSubscriptionId,
  accountRevision: 1,
  revision: 1,
  claimId: 'd'.repeat(24),
};
const empty = { rows: [], afterId: null, exhausted: true };
const vendor: Input['vendor'] = {
  subscription: async () => subscription,
  invoice: async () => invoice,
  latestPaidInvoice: async () => ({
    object: 'list',
    data: [invoice],
    has_more: false,
  }),
};
function store(): Input['store'] {
  return {
    customers: async () => empty,
    receipts: async () => empty,
    claim: async () => claim,
    apply: async () => 'applied',
    retry: async () => true,
    receive: async () => 'recorded',
  };
}

test('reconciliation advances bounded pages past failed identities and restarts the durable scan', async () => {
  const scans: unknown[] = [],
    applied: string[] = [],
    received: string[] = [],
    failures: string[] = [];
  const worker = createSubscriptionReconciliation({
    mode: 'test',
    priceId: identity.priceId,
    vendor,
    store: {
      ...store(),
      receipts: async (input) => {
        scans.push(['receipts', input]);
        return input.afterId
          ? empty
          : {
              rows: [
                {
                  id: 'r1',
                  eventId: 'evt_bad',
                  customerId: identity.customerId,
                  mode: 'test',
                },
                {
                  id: 'r2',
                  eventId: 'evt_good',
                  customerId: identity.customerId,
                  mode: 'test',
                },
              ],
              afterId: 'r2',
              exhausted: false,
            };
      },
      receive: async ({ eventId }) => {
        received.push(eventId);
        if (eventId === 'evt_bad') throw Error('controlled receipt failure');
        return 'recorded';
      },
      customers: async (input) => {
        scans.push(['customers', input]);
        return input.afterId
          ? empty
          : {
              rows: [{ customerId: 'bad' }, { customerId: claim.customerId }],
              afterId: claim.customerId,
              exhausted: false,
            };
      },
      claim: async (customerId) => {
        if (customerId === 'bad') throw Error('controlled claim failure');
        return claim;
      },
      apply: async (current, evidence) => {
        applied.push(`${current.customerId}:${evidence.settlement.kind}`);
        return 'applied';
      },
    },
    failed: (_error, stage) => {
      failures.push(stage);
    },
  });
  await worker.run();
  await worker.run();
  await worker.run();
  worker.stop();
  await worker.run();
  assert({
    given: 'a repeatedly failing first receipt/customer and later healthy work',
    should:
      'process later identities, advance cursors, revisit the cycle and bound every page',
    actual: [scans, received, applied, failures],
    expected: [
      [
        ['receipts', { mode: 'test', limit: 25 }],
        ['customers', { mode: 'test', limit: 3 }],
        ['receipts', { mode: 'test', limit: 25, afterId: 'r2' }],
        ['customers', { mode: 'test', limit: 3, afterId: claim.customerId }],
        ['receipts', { mode: 'test', limit: 25 }],
        ['customers', { mode: 'test', limit: 3 }],
      ],
      ['evt_bad', 'evt_good', 'evt_bad', 'evt_good'],
      [`${claim.customerId}:paid`, `${claim.customerId}:paid`],
      ['receipts', 'synchronize', 'receipts', 'synchronize'],
    ],
  });
});

test('transport and invalid vendor observations retain retry work without applying fabricated nonpayment', async () => {
  for (const failure of ['transport', 'invalid'] as const) {
    const outcomes: string[] = [];
    const worker = createSubscriptionReconciliation({
      mode: 'test',
      priceId: identity.priceId,
      vendor: {
        ...vendor,
        subscription: async () => {
          if (failure === 'transport')
            throw Error('raw vendor payload must not escape');
          return {};
        },
      },
      store: {
        ...store(),
        customers: async () => ({
          rows: [{ customerId: claim.customerId }],
          afterId: null,
          exhausted: true,
        }),
        apply: async () => {
          outcomes.push('applied');
          return 'applied';
        },
        retry: async () => {
          outcomes.push('retry');
          return true;
        },
      },
      failed: (error, stage) => {
        outcomes.push(`${stage}:${isAppError(error) ? error.code : 'raw'}`);
      },
    });
    await worker.run();
    assert({
      given: `${failure} vendor response`,
      should: 'leave a durable retry with only a safe typed failure',
      actual: outcomes,
      expected: [
        'retry',
        `synchronize:${failure === 'transport' ? 'INFRASTRUCTURE' : 'VALIDATION'}`,
      ],
    });
  }
});

test('stopping during a bounded vendor read leaves the claim for recovery and starts no later work', async () => {
  const entered = Promise.withResolvers<void>(),
    finish = Promise.withResolvers<unknown>();
  const calls: string[] = [];
  const worker = createSubscriptionReconciliation({
    mode: 'test',
    priceId: identity.priceId,
    vendor: {
      ...vendor,
      subscription: async () => {
        calls.push('vendor');
        entered.resolve();
        return finish.promise;
      },
    },
    store: {
      ...store(),
      customers: async () => ({
        rows: [{ customerId: claim.customerId }, { customerId: 'next' }],
        afterId: null,
        exhausted: true,
      }),
      claim: async () => {
        calls.push('claim');
        return claim;
      },
      apply: async () => {
        calls.push('apply');
        return 'applied';
      },
      retry: async () => {
        calls.push('retry');
        return true;
      },
    },
    failed: () => {
      calls.push('failed');
    },
  });
  const running = worker.run();
  await entered.promise;
  worker.stop();
  finish.resolve(subscription);
  await running;
  await worker.run();
  assert({
    given: 'stop arrives between claim and completed vendor observation',
    should:
      'leave durable recovery authority untouched and stop before application or another claim',
    actual: calls,
    expected: ['claim', 'vendor'],
  });
});

test('a claim from another configured Stripe mode never reaches that vendor client', async () => {
  const calls: string[] = [];
  const worker = createSubscriptionReconciliation({
    mode: 'test',
    priceId: identity.priceId,
    vendor: {
      ...vendor,
      subscription: async () => {
        calls.push('vendor');
        return subscription;
      },
    },
    store: {
      ...store(),
      customers: async () => ({
        rows: [{ customerId: claim.customerId }],
        afterId: null,
        exhausted: true,
      }),
      claim: async () => ({ ...claim, mode: 'live' }),
    },
    failed: (error) => {
      calls.push(isAppError(error) ? error.code : 'raw');
    },
  });
  await worker.run();
  assert({
    given: 'an inconsistent mode from discovery',
    should: 'refuse before vendor I/O',
    actual: calls,
    expected: ['CONFLICT'],
  });
});
