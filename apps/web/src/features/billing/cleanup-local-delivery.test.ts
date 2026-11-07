import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { CleanupWork } from '@daisy/protocol/billing';
import { createLocalCleanupDelivery } from './cleanup-local-delivery';
import { purchase } from './checkout.test-support';
import { refundFixture } from './refund.test-support';
setupRitewayBun();
type Store = Parameters<typeof createLocalCleanupDelivery>[0]['store'];
const input = {
  jobId: 'j'.repeat(24),
  claimId: 'c'.repeat(24),
  retryAt: '2026-11-06T00:01:00.000Z',
};
const selected = (lane: 'purchases' | 'refunds', id: string): CleanupWork => ({
  kind: 'scan',
  lane,
  scan: {
    kind: 'selected',
    id,
    rest: [],
    lastId: id,
    more: false,
    detail: { kind: 'resource' },
  },
});

test('cleanup does not turn pending purchase or refund knowledge into resolution or a new money action', async () => {
  const fixture = refundFixture(),
    events: unknown[] = [];
  const resource: Awaited<ReturnType<Store['resources']>>[] = [
    { kind: 'purchase', purchase },
    { kind: 'refund', action: fixture.base },
  ];
  const store: Store = {
    resources: async () => resource.shift()!,
    record: async (jobId, event) => {
      events.push([jobId, event]);
      return 'failure';
    },
  };
  const deliver = createLocalCleanupDelivery({ store, running: () => true });
  const first = { ...input, work: selected('purchases', purchase.id) },
    second = { ...input, work: selected('refunds', fixture.base.id) };
  const actual = [await deliver(first), await deliver(second)];
  assert({
    given:
      'owned purchase with possibly executed creation and original ready refund obligation',
    should:
      'consume only the exact failure claims for fair retry without creating, resolving or changing money identity',
    actual: [actual, events],
    expected: [
      ['failure', 'failure'],
      [
        [
          input.jobId,
          {
            kind: 'failure',
            claimId: input.claimId,
            work: first.work,
            retryAt: input.retryAt,
          },
        ],
        [
          input.jobId,
          {
            kind: 'failure',
            claimId: input.claimId,
            work: second.work,
            retryAt: input.retryAt,
          },
        ],
      ],
    ],
  });
});

test('only known succeeded refund and explicit purchase terminal knowledge propose current resolution', async () => {
  const fixture = refundFixture(),
    events: unknown[] = [];
  const resources: Awaited<ReturnType<Store['resources']>>[] = [
    {
      kind: 'purchase',
      purchase: {
        ...purchase,
        state: { kind: 'abandoned', abandonedAt: fixture.now },
      },
    },
    {
      kind: 'refund',
      action: {
        ...fixture.base,
        state: {
          kind: 'known',
          startedAt: fixture.now,
          refundId: 're_original',
          status: 'succeeded',
          observedAt: fixture.now,
        },
      },
    },
  ];
  const store: Store = {
    resources: async () => resources.shift()!,
    record: async (jobId, event) => {
      events.push([jobId, event]);
      return 'progress';
    },
  };
  const deliver = createLocalCleanupDelivery({ store, running: () => true }),
    first = { ...input, work: selected('purchases', purchase.id) },
    second = { ...input, work: selected('refunds', fixture.base.id) };
  assert({
    given: 'explicitly terminal original local resources',
    should: 'submit exact resolution events for the database to revalidate',
    actual: [await deliver(first), await deliver(second), events],
    expected: [
      'progress',
      'progress',
      [
        [
          input.jobId,
          { kind: 'resolved', claimId: input.claimId, work: first.work },
        ],
        [
          input.jobId,
          { kind: 'resolved', claimId: input.claimId, work: second.work },
        ],
      ],
    ],
  });
});

test('stale local reads and unrelated lanes do not mutate retries or execution', async () => {
  let reads = 0,
    writes = 0;
  const deliver = createLocalCleanupDelivery({
    running: () => true,
    store: {
      resources: async () => {
        reads++;
        return { kind: 'refuse' };
      },
      record: async () => {
        writes++;
        return 'progress';
      },
    },
  });
  const stale = await deliver({
    ...input,
    work: selected('refunds', 'r'.repeat(24)),
  });
  const other = await deliver({
    ...input,
    work: {
      kind: 'scan',
      lane: 'subscriptions',
      scan: { kind: 'page', afterId: null },
    },
  });
  assert({
    given: 'a refused current-resource read and a vendor-owned lane',
    should: 'leave idle or delegate without retry/accounting mutation',
    actual: [stale, other, reads, writes],
    expected: ['idle', 'unhandled', 1, 0],
  });
});
