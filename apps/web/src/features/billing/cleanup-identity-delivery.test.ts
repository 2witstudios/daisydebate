import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createCleanupIdentityDelivery } from './cleanup-identity-delivery';
setupRitewayBun();
type Input = Parameters<typeof createCleanupIdentityDelivery>[0];
type Request = Parameters<ReturnType<typeof createCleanupIdentityDelivery>>[0];
const request: Request = {
  jobId: 'j'.repeat(24),
  claimId: 'c'.repeat(24),
  retryAt: '2026-11-06T00:01:00.000Z',
  work: { kind: 'invoice-identity', invoiceId: 'in_owned' },
};
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
      possiblePurchases: 1,
      retainedFinancialRoutes: 0,
      owedFinancialEffects: false,
    },
  },
};
const invoice = {
  id: 'in_owned',
  object: 'invoice',
  customer: 'cus_owned',
  livemode: false,
};
const unexpected = async () => {
  throw Error('Unexpected cleanup effect');
};
const resources = (): Input => ({
  mode: 'test',
  running: () => true,
  port: { invoice: async () => invoice },
  store: {
    inspect: async () => current,
    retainInvoiceIdentity: unexpected,
    recordInvoices: unexpected,
    record: unexpected,
  },
});

test('predecessor debt cannot guess a route or consume a different invoice', async () => {
  const effects: unknown[] = [];
  const missing = createCleanupIdentityDelivery({
    ...resources(),
    store: {
      ...resources().store,
      inspect: async () => ({
        ...current,
        facts: { ...current.facts, route: { kind: 'unresolved' } },
      }),
      record: async (_job, event) => {
        effects.push(event);
        return 'failure';
      },
    },
    port: { invoice: unexpected },
  });
  const foreign = createCleanupIdentityDelivery({
    ...resources(),
    port: { invoice: async () => ({ ...invoice, id: 'in_other' }) },
    store: {
      ...resources().store,
      record: async (_job, event) => {
        effects.push(event);
        return 'failure';
      },
    },
  });
  assert({
    given:
      'missing owned routing or a positive read naming a different invoice',
    should:
      'retain debt and consume only failure authority without retaining the wrong resource',
    actual: [await missing(request), await foreign(request), effects],
    expected: [
      'failure',
      'failure',
      [
        {
          kind: 'failure',
          claimId: request.claimId,
          work: request.work,
          retryAt: request.retryAt,
        },
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

test('late exact invoice evidence is retained without old execution authority', async () => {
  const retained: unknown[] = [];
  let calls = 0;
  const deliver = createCleanupIdentityDelivery({
    ...resources(),
    store: {
      ...resources().store,
      retainInvoiceIdentity: async () => 'idle',
      recordInvoices: async (...args) => {
        retained.push(args);
        return ++calls === 1 ? 'recorded' : 'unchanged';
      },
    },
  });
  const read = {
    mode: 'test',
    customerId: 'cus_owned',
    invoiceId: 'in_owned',
    source: { kind: 'unresolved', vendorSubscriptionId: null, priceId: null },
  };
  assert({
    given: 'the original claim retired after its positive owned invoice read',
    should:
      'reopen through account authority once without changing execution on replay',
    actual: [await deliver(request), await deliver(request), retained],
    expected: [
      'reopened',
      'idle',
      [
        [current.userId, [read]],
        [current.userId, [read]],
      ],
    ],
  });
});

test('database admission errors propagate and shutdown cannot schedule a fallback write', async () => {
  const problem = Error('Controlled database failure');
  let stopped = false,
    late = 0;
  const failing = createCleanupIdentityDelivery({
    ...resources(),
    store: {
      ...resources().store,
      retainInvoiceIdentity: async () => {
        throw problem;
      },
      recordInvoices: async () => {
        late++;
        return 'recorded';
      },
    },
  });
  let propagated = false;
  try {
    await failing(request);
  } catch (error) {
    propagated = error === problem;
  }
  const stopping = createCleanupIdentityDelivery({
    ...resources(),
    running: () => !stopped,
    store: {
      ...resources().store,
      retainInvoiceIdentity: async () => {
        stopped = true;
        return 'idle';
      },
      recordInvoices: async () => {
        late++;
        return 'recorded';
      },
    },
  });
  assert({
    given: 'a database failure or stop during the final debt admission',
    should: 'preserve the failure and admit no fallback after shutdown',
    actual: [propagated, await stopping(request), late],
    expected: [true, 'idle', 0],
  });
});
