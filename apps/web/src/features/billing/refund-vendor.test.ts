import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import { advanceRefund, refundActionSchema } from '@daisy/protocol/billing';
import { createRefundVendor, type RefundPort } from './refund-vendor';

setupRitewayBun();
const now = '2026-11-05T00:00:03.000Z';
const claimId = 'c'.repeat(24);
const base = refundActionSchema.parse({
  id: 'r'.repeat(24),
  userId: 'u'.repeat(24),
  mode: 'test',
  customerId: 'cus_original',
  chargeId: 'ch_original',
  invoiceId: 'in_original',
  vendorSubscriptionId: 'sub_original',
  amountMinor: 1000,
  currency: 'usd',
  period: {
    startsAt: '2026-11-01T00:00:00.000Z',
    endsAt: '2026-12-01T00:00:00.000Z',
  },
  closedAt: '2026-11-05T00:00:00.000Z',
  paidAtSeconds: 1793836801,
  admittedAt: '2026-11-05T00:00:02.000Z',
  state: { kind: 'ready' },
  claim: null,
});
const transition = advanceRefund(
  base,
  { kind: 'claim', claimId },
  { now, authority: 'closed' },
);
if (transition.kind !== 'changed') throw Error('Fixture claim refused');
const action = transition.action;
const refund = {
  object: 'refund',
  id: 're_original',
  charge: 'ch_original',
  customer: 'cus_original',
  amount: 1000,
  currency: 'usd',
  status: 'pending',
  metadata: { daisy_refund_action_id: base.id },
};
const unexpected = async () => {
  throw Error('Unexpected transport');
};

test('refund vendor checks mode and current claim before I/O and preserves same action parameters/key', async () => {
  const calls: unknown[] = [];
  const port: RefundPort = {
    create: async (parameters, key) => {
      calls.push([parameters, key]);
      return refund;
    },
    retrieve: unexpected,
    list: unexpected,
  };
  const vendor = (clock = now, mode: 'test' | 'live' = 'test') =>
    createRefundVendor({ port, clock: fixedClock(clock), mode });
  const refused = await Promise.all([
    vendor(now, 'live').run(action, claimId),
    vendor('2026-11-05T00:00:33.000Z').run(action, claimId),
    vendor().run(action, 'x'.repeat(24)),
    vendor().run(base, claimId),
    vendor().run(
      { ...action, paidAtSeconds: Date.parse(action.closedAt) / 1000 },
      claimId,
    ),
  ]);
  assert({
    given: 'wrong mode, expired or missing/mismatched authority',
    should: 'make no vendor request',
    actual: [refused, calls],
    expected: [Array(5).fill({ kind: 'refuse' }), []],
  });
  const observed = await vendor().run(action, claimId);
  await vendor().run(action, claimId);
  assert({
    given: 'retrying the current original action',
    should:
      'send the identical frozen refund request/key and normalize the response',
    actual: [observed, calls],
    expected: [
      { kind: 'observe', claimId, refundId: 're_original', status: 'pending' },
      Array(2).fill([
        {
          charge: 'ch_original',
          amount: 1000,
          metadata: { daisy_refund_action_id: base.id },
        },
        `daisy-closure-refund:${base.id}`,
      ]),
    ],
  });
});

test('foreign refund identity, amount, routing or action marker refuses and lost replies stay unresolved', async () => {
  const patches = [
    { charge: 'ch_other' },
    { customer: 'cus_other' },
    { amount: 999 },
    { currency: 'eur' },
    { metadata: { daisy_refund_action_id: 'other' } },
    { status: 'unrecognized' },
  ];
  const outcomes = [];
  for (const patch of patches)
    outcomes.push(
      await createRefundVendor({
        mode: 'test',
        clock: fixedClock(now),
        port: {
          create: async () => ({ ...refund, ...patch }),
          retrieve: unexpected,
          list: unexpected,
        },
      }).run(action, claimId),
    );
  const unknown = await createRefundVendor({
    mode: 'test',
    clock: fixedClock(now),
    port: {
      create: async () => {
        throw Error('private response');
      },
      retrieve: unexpected,
      list: unexpected,
    },
  }).run(action, claimId);
  assert({
    given: 'foreign/malformed vendor facts or an uncertain response',
    should:
      'grant no accepted observation or new refund identity and keep raw errors private',
    actual: [outcomes, unknown],
    expected: [
      Array(6).fill({ kind: 'refuse' }),
      { kind: 'unresolved', claimId },
    ],
  });
});

test('refund discovery bounds each page and never interprets no match as definite nonexecution', async () => {
  const later = '2026-11-05T00:05:03.000Z';
  const nextId = 'd'.repeat(24);
  const next = advanceRefund(
    action,
    { kind: 'claim', claimId: nextId },
    { now: later, authority: 'closed' },
  );
  if (next.kind !== 'changed') throw Error('Fixture discovery refused');
  const queries: unknown[] = [];
  const vendor = (data: unknown[], has_more = false) =>
    createRefundVendor({
      mode: 'test',
      clock: fixedClock(later),
      port: {
        create: unexpected,
        retrieve: async (id) => {
          queries.push(id);
          return refund;
        },
        list: async (parameters) => {
          queries.push(parameters);
          return { object: 'list', data, has_more };
        },
      },
    });
  const empty = await vendor([]).run(next.action, nextId);
  const found = await vendor([refund]).run(next.action, nextId);
  assert({
    given: 'a full empty page then a matching original action',
    should:
      'retain uncertainty first, then retrieve only the owned match with bounded parameters',
    actual: [empty, found, queries],
    expected: [
      {
        kind: 'searched',
        claimId: nextId,
        beforeRefundId: null,
        afterRefundId: null,
      },
      {
        kind: 'observe',
        claimId: nextId,
        refundId: 're_original',
        status: 'pending',
      },
      [
        { charge: 'ch_original', limit: 100 },
        { charge: 'ch_original', limit: 100 },
        're_original',
      ],
    ],
  });
});
