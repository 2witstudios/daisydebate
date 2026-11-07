import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import { createCheckoutVendor, type CheckoutPort } from './checkout-vendor';
import { purchase, checkoutSession } from './checkout.test-support';
setupRitewayBun();
const claimId = 'c'.repeat(24);

test('a create request checks its current durable claim and mode immediately before vendor I/O', async () => {
  const calls: { key: string; parameters: unknown }[] = [];
  const port: CheckoutPort = {
    create: async (parameters, key) => {
      calls.push({ key, parameters });
      return checkoutSession;
    },
    retrieve: async () => {
      throw Error('Unexpected retrieval');
    },
    expire: async () => {
      throw Error('Unexpected expiration');
    },
  };
  const vendor = (now: string, mode: 'test' | 'live' = 'test') =>
    createCheckoutVendor({ port, mode, clock: fixedClock(now) });
  const refused = await Promise.all([
    vendor('2026-11-05T00:00:31.000Z').create(purchase, claimId),
    vendor('2026-11-05T00:00:00.999Z').create(purchase, claimId),
    vendor('2026-11-05T00:00:02.000Z', 'live').create(purchase, claimId),
    vendor('2026-11-05T00:00:02.000Z').create(purchase, 'd'.repeat(24)),
    vendor('invalid').create(purchase, claimId),
    vendor('2026-11-05T00:00:02.000Z').create(
      { ...purchase, state: { kind: 'admitted' } },
      claimId,
    ),
  ]);
  assert({
    given:
      'expired, future, wrong-mode, wrong-claim, invalid-time and undispatched inputs',
    should: 'perform no vendor request',
    actual: [refused.map((r) => r.kind), calls.length],
    expected: [Array(6).fill('refuse'), 0],
  });
  const result = await vendor('2026-11-05T00:00:02.000Z').create(
    purchase,
    claimId,
  );
  assert({
    given: 'the current persisted claim before its deadline',
    should: 'make one frozen same-key request and validate its response',
    actual: [result.kind, calls.length, calls[0]?.key],
    expected: ['observed', 1, `daisy-premium:${purchase.id}`],
  });
});

test('lost vendor replies are unknown and raw vendor errors never escape', async () => {
  const vendor = createCheckoutVendor({
    clock: fixedClock('2026-11-05T00:00:02.000Z'),
    mode: 'test',
    port: {
      create: async () => {
        throw Error('raw vendor payload must remain private');
      },
      retrieve: async () => {
        throw Error('raw vendor payload must remain private');
      },
      expire: async () => {
        throw Error('raw vendor payload must remain private');
      },
    },
  });
  const open = {
    ...purchase,
    state: {
      kind: 'open' as const,
      startedAt: '2026-11-05T00:00:01.000Z',
      sessionId: checkoutSession.id,
      customerId: null,
    },
  };
  assert({
    given: 'transport failure on create, retrieve and expire',
    should:
      'retain uncertainty without a false nonservice/expiration result or raw exception',
    actual: await Promise.all([
      vendor.create(purchase, claimId),
      vendor.retrieve(open),
      vendor.expire(open),
    ]),
    expected: [{ kind: 'unknown' }, { kind: 'unknown' }, { kind: 'unknown' }],
  });
});

test('retrieval and expiration use only the already-owned session and validate returned identity', async () => {
  const calls: string[] = [];
  const vendor = createCheckoutVendor({
    clock: fixedClock('2026-11-05T02:00:00.000Z'),
    mode: 'test',
    port: {
      create: async () => {
        throw Error('Unexpected creation');
      },
      retrieve: async (id) => {
        calls.push(id);
        return checkoutSession;
      },
      expire: async (id) => {
        calls.push(id);
        return { ...checkoutSession, status: 'expired', url: null };
      },
    },
  });
  const open = {
    ...purchase,
    state: {
      kind: 'open' as const,
      startedAt: '2026-11-05T00:00:01.000Z',
      sessionId: checkoutSession.id,
      customerId: null,
    },
  };
  assert({
    given: 'an expired local deadline with a known session',
    should: 'permit observation/expiration without issuing a new creation',
    actual: [
      (await vendor.retrieve(open)).kind,
      (await vendor.expire(open)).kind,
      await vendor.retrieve(purchase),
      await vendor.expire({ ...open, mode: 'live' }),
      calls,
    ],
    expected: [
      'observed',
      'observed',
      { kind: 'refuse' },
      { kind: 'refuse' },
      [checkoutSession.id, checkoutSession.id, checkoutSession.id],
    ],
  });
});

test('an expiration committed before its reply was lost is recovered by the same owned Session read', async () => {
  let expired = false;
  const calls: string[] = [];
  const open = {
    ...purchase,
    state: {
      kind: 'open' as const,
      startedAt: '2026-11-05T00:00:01.000Z',
      sessionId: checkoutSession.id,
      customerId: null,
    },
  };
  const vendor = createCheckoutVendor({
    clock: fixedClock('2026-11-05T02:00:00.000Z'),
    mode: 'test',
    port: {
      create: async () => {
        throw Error('Unexpected creation');
      },
      retrieve: async (id) => {
        calls.push(`retrieve:${id}`);
        return expired
          ? { ...checkoutSession, status: 'expired', url: null }
          : checkoutSession;
      },
      expire: async (id) => {
        calls.push(`expire:${id}`);
        if (expired) throw Error('Already expired');
        expired = true;
        throw Error('Controlled reply loss after actual vendor-side effect');
      },
    },
  });
  const first = await vendor.expire(open),
    second = await vendor.expire(open);
  assert({
    given:
      'same Session expiration committed but its response was lost, so a repeated expire errors',
    should:
      'retain first uncertainty then positively recover terminal state without another money attempt or key',
    actual: [
      first.kind,
      second.kind,
      second.kind === 'observed' ? second.session.kind : null,
    ],
    expected: ['unknown', 'observed', 'expired'],
  });
});
