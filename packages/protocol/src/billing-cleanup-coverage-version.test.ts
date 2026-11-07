import { assert, setupRitewayBun, test } from 'riteway/bun';
import { billingCleanupSchema, startCleanup } from './billing-cleanup';
import { advanceCleanup } from './billing-cleanup-lifecycle';
setupRitewayBun();

test('predecessor completed invoice heads cannot carry current cleanup admission authority', () => {
  const jobId = 'abcdefghijklmnopqrstuvwx',
    now = '2026-11-06T00:00:00.000Z';
  const predecessor = {
    version: 2,
    kind: 'scanning',
    jobId,
    retryAt: now,
    claim: null,
    turn: 'refunds',
    invoiceDebt: { kind: 'none' },
    scans: {
      purchases: { kind: 'complete' },
      subscriptions: { kind: 'complete' },
      invoices: { kind: 'complete' },
      refunds: { kind: 'page', afterId: null },
      observations: { kind: 'complete' },
    },
  };
  const current = startCleanup(jobId, now);
  const checked = billingCleanupSchema.safeParse(predecessor);
  assert({
    given:
      'pending v2 completed invoice/observation heads with only a remaining refund page and a fresh current execution',
    should:
      'require a forward fresh-coverage transition before accepting any old claim while keeping new execution available',
    actual: [
      billingCleanupSchema.safeParse(predecessor).success,
      checked.success
        ? advanceCleanup(
            checked.data,
            { kind: 'claim', claimId: 'zyxwvutsrqponmlkjihgfedc' },
            { jobId, now, closed: true },
          ).kind
        : 'idle',
      current?.kind === 'scanning' ? current.version : null,
      billingCleanupSchema.safeParse(current).success,
    ],
    expected: [false, 'idle', 3, true],
  });
});
