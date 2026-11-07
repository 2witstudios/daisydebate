import { assert, setupRitewayBun, test } from 'riteway/bun';
import { isAppError } from '@daisy/errors';
import { createPurchaseReconciliation } from './purchase-reconciliation';
import { purchase } from './checkout.test-support';

setupRitewayBun();
type Input = Parameters<typeof createPurchaseReconciliation>[0];
const page = {
  rows: [{ purchaseId: purchase.id }],
  afterId: null,
  exhausted: true,
};
const context = {
  now: '2026-11-05T00:10:00.000Z',
  authority: 'active' as const,
};
const unknown = { kind: 'unknown' } as const;
function store(): Input['store'] {
  return {
    purchases: async () => page,
    inspect: async () => ({
      purchase,
      context,
      closedAt: null,
      work: 'discover',
    }),
    record: async () => 'changed',
  };
}

test('purchase recovery has no create authority and advances durable discovery past failed identities', async () => {
  const scans: unknown[] = [],
    calls: string[] = [],
    failures: string[] = [];
  const worker = createPurchaseReconciliation({
    mode: 'test',
    vendor: {
      retrieve: async () => {
        throw Error('Unexpected retrieval');
      },
      expire: async () => {
        throw Error('Unexpected expiration');
      },
    },
    discover: async (value) => {
      calls.push(value.priceId);
      return { kind: 'searched', beforeSessionId: null, afterSessionId: null };
    },
    failed: (error, stage) => {
      failures.push(`${stage}:${isAppError(error) ? error.code : 'raw'}`);
    },
    store: {
      ...store(),
      purchases: async (input) => {
        scans.push(input);
        return input.afterId
          ? { rows: [], afterId: null, exhausted: true }
          : {
              rows: [{ purchaseId: 'bad' }, ...page.rows],
              afterId: purchase.id,
              exhausted: false,
            };
      },
      inspect: async (id) => {
        if (id === 'bad') throw Error('Controlled current-account failure');
        return { purchase, context, closedAt: null, work: 'discover' };
      },
      record: async (id, event) => {
        calls.push(`${id}:${event.kind}`);
        return 'changed';
      },
    },
  });
  await worker.run();
  await worker.run();
  await worker.run();
  worker.stop();
  await worker.run();
  assert({
    given:
      'a repeatedly failing first identity and later possible prior Session effects',
    should:
      'retain original price/attempt, process bounded later work and revisit head without a creation API',
    actual: [scans, calls, failures],
    expected: [
      [
        { mode: 'test', limit: 3 },
        { mode: 'test', limit: 3, afterId: purchase.id },
        { mode: 'test', limit: 3 },
      ],
      [
        'price_fixture',
        `${purchase.id}:searched`,
        'price_fixture',
        `${purchase.id}:searched`,
      ],
      ['recover:raw', 'recover:raw'],
    ],
  });
});

test('closed unknown purchase facts survive shutdown and are recorded through the existing atomic cleanup-reopen owner', async () => {
  const entered = Promise.withResolvers<void>(),
    finish = Promise.withResolvers<void>();
  const records: unknown[] = [];
  const session = {
    kind: 'complete' as const,
    id: 'cs_test_original',
    customerId: 'cus_original',
    subscriptionId: 'sub_original',
  };
  const worker = createPurchaseReconciliation({
    mode: 'test',
    vendor: { retrieve: async () => unknown, expire: async () => unknown },
    discover: async () => {
      entered.resolve();
      await finish.promise;
      return { kind: 'observed', session, url: null };
    },
    failed: () => {
      throw Error('Unexpected recovery failure');
    },
    store: {
      ...store(),
      inspect: async () => ({
        purchase,
        context: { ...context, authority: 'closed' },
        closedAt: '2026-11-05T00:02:00.000Z',
        work: 'cleanup',
      }),
      record: async (id, event) => {
        records.push([id, event]);
        return 'changed';
      },
    },
  });
  const running = worker.run();
  await entered.promise;
  worker.stop();
  finish.resolve();
  await running;
  await worker.run();
  assert({
    given:
      'a late original Session response after account closure and process drain',
    should:
      'retain exactly that positive effect for fenced cleanup, with no new attempt or grant',
    actual: records,
    expected: [[purchase.id, { kind: 'observe', session }]],
  });
});

test('foreign mode and unavailable purchase reads never fabricate a stored observation', async () => {
  for (const foreign of [true, false]) {
    let transport = 0,
      writes = 0;
    const worker = createPurchaseReconciliation({
      mode: 'test',
      vendor: { retrieve: async () => unknown, expire: async () => unknown },
      discover: async () => {
        transport += 1;
        return unknown;
      },
      failed: () => undefined,
      store: {
        ...store(),
        inspect: async () => ({
          purchase: { ...purchase, mode: foreign ? 'live' : 'test' },
          context,
          closedAt: null,
          work: 'discover',
        }),
        record: async () => {
          writes += 1;
          return 'changed';
        },
      },
    });
    await worker.run();
    assert({
      given: foreign
        ? 'an original purchase in a different mode'
        : 'unresolved possible execution',
      should:
        'keep authority and unknown accounting unchanged without a fabricated absence or new key',
      actual: [transport, writes],
      expected: [foreign ? 0 : 1, 0],
    });
  }
});
