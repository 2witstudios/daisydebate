import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { CleanupWork } from '@daisy/protocol/billing';
import { createCleanupDiscoveryReader } from './cleanup-discovery-reader';
setupRitewayBun();
const owner = { mode: 'test', customerId: 'cus_owned' } as const;
const head = (lane: 'invoices' | 'subscriptions'): CleanupWork => ({
  kind: 'scan',
  lane,
  scan: { kind: 'page', afterId: null },
});
const invoice = {
  id: 'in_owned',
  object: 'invoice',
  customer: owner.customerId,
  livemode: false,
};
const page = (data: unknown[]) => ({ object: 'list', has_more: false, data });

test('invoice discovery retains only positive owned identity and keeps mixed pages explicitly incomplete', async () => {
  const calls: unknown[] = [];
  const reader = createCleanupDiscoveryReader({
    mode: 'test',
    port: {
      invoices: async (request) => {
        calls.push(request);
        return page([
          invoice,
          { ...invoice, id: 'in_foreign', customer: 'cus_foreign' },
        ]);
      },
      subscriptions: async () => {
        throw Error('Unexpected subscription read');
      },
    },
  });
  assert({
    given:
      'a retrieved invoice page containing one exact owned invoice and one foreign object',
    should:
      'retain the positive owned identity with honest unknown offer while supplying no cursor/coverage authority',
    actual: [await reader(owner, head('invoices')), calls],
    expected: [
      {
        kind: 'invoice-reads',
        reads: [
          {
            ...owner,
            invoiceId: invoice.id,
            source: {
              kind: 'unresolved',
              vendorSubscriptionId: null,
              priceId: null,
            },
          },
        ],
      },
      [{ customer: owner.customerId, afterId: null }],
    ],
  });
});
test('complete discovery pages preserve actual exhaustion and subscription IDs without inferring frozen offer', async () => {
  const reader = createCleanupDiscoveryReader({
    mode: 'test',
    port: {
      invoices: async () => page([invoice]),
      subscriptions: async () =>
        page([{ ...invoice, id: 'sub_owned', object: 'subscription' }]),
    },
  });
  assert({
    given:
      'separate complete exact-customer invoice and subscription responses',
    should:
      'return their bounded identities while leaving invoice money and subscription cancellation undecided',
    actual: [
      await reader(owner, head('invoices')),
      await reader(owner, head('subscriptions')),
    ],
    expected: [
      {
        kind: 'invoice-page',
        reads: [
          {
            ...owner,
            invoiceId: invoice.id,
            source: {
              kind: 'unresolved',
              vendorSubscriptionId: null,
              priceId: null,
            },
          },
        ],
        more: false,
      },
      { kind: 'subscription-page', ids: ['sub_owned'], more: false },
    ],
  });
});
test('foreign mode, wrong work, oversized and duplicate subscription responses never advance discovery', async () => {
  let calls = 0;
  const reader = createCleanupDiscoveryReader({
    mode: 'test',
    port: {
      invoices: async () => {
        calls++;
        return page(Array.from({ length: 21 }, () => invoice));
      },
      subscriptions: async () => {
        calls++;
        return page(
          Array.from({ length: 2 }, () => ({
            ...invoice,
            id: 'sub_owned',
            object: 'subscription',
          })),
        );
      },
    },
  });
  assert({
    given: 'wrong transport mode/work and malformed producer page membership',
    should:
      'refuse authority without consuming wrong resources or inventing cursor progress',
    actual: [
      await reader({ ...owner, mode: 'live' }, head('invoices')),
      await reader(owner, { kind: 'delete' }),
      await reader(owner, head('invoices')),
      await reader(owner, head('subscriptions')),
      calls,
    ],
    expected: [
      { kind: 'unavailable' },
      { kind: 'unavailable' },
      { kind: 'unavailable' },
      { kind: 'unavailable' },
      2,
    ],
  });
});

test('overlapping and contradictory invoice identities retain positive provenance without a page advance', async () => {
  const first = {
    ...invoice,
    parent: {
      type: 'subscription_details',
      subscription_details: { subscription: 'sub_first' },
    },
  };
  const second = {
    ...invoice,
    parent: {
      type: 'subscription_details',
      subscription_details: { subscription: { id: 'sub_second' } },
    },
  };
  const reader = createCleanupDiscoveryReader({
    mode: 'test',
    port: {
      invoices: async () => page([first, second]),
      subscriptions: async () => page([]),
    },
  });
  const work: CleanupWork = {
    kind: 'scan',
    lane: 'invoices',
    scan: { kind: 'page', afterId: invoice.id },
  };
  assert({
    given:
      'a returned prior cursor and duplicate owned invoice identity with conflicting positive subscription references',
    should:
      'retain both actual source observations for sticky conflict accounting while refusing cursor authority',
    actual: await reader(owner, work),
    expected: {
      kind: 'invoice-reads',
      reads: ['sub_first', 'sub_second'].map((vendorSubscriptionId) => ({
        ...owner,
        invoiceId: invoice.id,
        source: {
          kind: 'unresolved' as const,
          vendorSubscriptionId,
          priceId: null,
        },
      })),
    },
  });
});

test('empty non-exhausted producer pages are failures rather than idle cursor proposals', async () => {
  const reader = createCleanupDiscoveryReader({
    mode: 'test',
    port: {
      invoices: async () => ({ object: 'list', data: [], has_more: true }),
      subscriptions: async () => ({ object: 'list', data: [], has_more: true }),
    },
  });
  assert({
    given:
      'an inconsistent producer page claiming more work without any identity',
    should: 'supply no discovery transition for either lane',
    actual: [
      await reader(owner, head('invoices')),
      await reader(owner, head('subscriptions')),
    ],
    expected: [{ kind: 'unavailable' }, { kind: 'unavailable' }],
  });
});

test('positive unambiguous invoice pricing is retained as provenance without money authority', async () => {
  const { invoice: raw } =
    await import('./subscription-observation.test-support');
  const actual = { ...raw, customer: owner.customerId };
  const reader = createCleanupDiscoveryReader({
    mode: 'test',
    port: {
      invoices: async () => page([actual]),
      subscriptions: async () => page([]),
    },
  });
  assert({
    given:
      'a positively owned complete one-line subscription invoice with exact line/parent ownership',
    should:
      'retain its actual subscription and price identifiers while supplying no period/amount/refund proof',
    actual: await reader(owner, head('invoices')),
    expected: {
      kind: 'invoice-page',
      reads: [
        {
          ...owner,
          invoiceId: actual.id,
          source: {
            kind: 'unresolved',
            vendorSubscriptionId: 'sub_fixture',
            priceId: 'price_fixture',
          },
        },
      ],
      more: false,
    },
  });
});
