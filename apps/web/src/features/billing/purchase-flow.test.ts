import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createPurchaseFlow } from './purchase-flow';
import { purchase, checkoutSession } from './checkout.test-support';
setupRitewayBun();
const subject = { userId: purchase.userId, actorId: 'a'.repeat(24) };
const open = {
  ...purchase,
  state: {
    kind: 'open' as const,
    startedAt:
      purchase.state.kind === 'creating' ? purchase.state.startedAt : '',
    sessionId: checkoutSession.id,
    customerId: null,
  },
};

test('Checkout redirects only after recording and rechecking the current owned session', async () => {
  const events: string[] = [];
  const flow = createPurchaseFlow({
    admit: async () => ({ purchase }),
    store: {
      recover: async () => ({
        purchase,
        work: 'create',
        claimId: 'c'.repeat(24),
      }),
      record: async () => {
        events.push('record');
        return 'changed';
      },
      read: async () => {
        events.push('read');
        return open;
      },
    },
    vendor: {
      create: async () => ({
        kind: 'observed',
        session: { kind: 'open', id: checkoutSession.id, customerId: null },
        url: checkoutSession.url,
      }),
      retrieve: async () => {
        throw Error('Unexpected retrieval');
      },
      expire: async () => {
        throw Error('Unexpected expiry');
      },
    },
    discover: async () => {
      throw Error('Unexpected discovery');
    },
  });
  assert({
    given: 'a validated hosted session',
    should: 'persist then reauthorize before returning its URL',
    actual: [await flow(subject), events],
    expected: [
      { kind: 'redirect', url: checkoutSession.url },
      ['record', 'read'],
    ],
  });
});

test('an uncertain reply retains its durable purchase claim and never invents a destination', async () => {
  const recorded: unknown[] = [];
  const flow = createPurchaseFlow({
    admit: async () => ({ purchase }),
    store: {
      recover: async () => ({
        purchase,
        work: 'create',
        claimId: 'c'.repeat(24),
      }),
      record: async (_subject, id, event) => {
        recorded.push({ id, event });
        return 'changed';
      },
      read: async () => open,
    },
    vendor: {
      create: async () => ({ kind: 'unknown' }),
      retrieve: async () => ({ kind: 'unknown' }),
      expire: async () => ({ kind: 'unknown' }),
    },
    discover: async () => ({ kind: 'unknown' }),
  });
  assert({
    given: 'a lost create reply',
    should: 'record uncertainty against the same claim',
    actual: [await flow(subject), recorded],
    expected: [
      { kind: 'pending' },
      [
        {
          id: purchase.id,
          event: { kind: 'unknown', claimId: 'c'.repeat(24) },
        },
      ],
    ],
  });
});

test('a stale session response cannot redirect after a different current purchase state wins', async () => {
  const flow = createPurchaseFlow({
    admit: async () => ({ purchase }),
    store: {
      recover: async () => ({
        purchase: open,
        work: 'retrieve',
        claimId: null,
      }),
      record: async () => 'unchanged',
      read: async () => ({
        ...purchase,
        state: { kind: 'abandoned', abandonedAt: '2026-11-05T00:00:10.000Z' },
      }),
    },
    vendor: {
      create: async () => ({ kind: 'unknown' }),
      retrieve: async () => ({
        kind: 'observed',
        session: { kind: 'open', id: checkoutSession.id, customerId: null },
        url: checkoutSession.url,
      }),
      expire: async () => ({ kind: 'unknown' }),
    },
    discover: async () => ({ kind: 'unknown' }),
  });
  assert({
    given: 'an old vendor answer after current authority changed',
    should: 'offer no external destination',
    actual: await flow(subject),
    expected: { kind: 'pending' },
  });
});
