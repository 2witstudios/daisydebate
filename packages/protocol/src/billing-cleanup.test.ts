import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  billingCleanupSchema,
  cleanupWork,
  type CleanupEvent,
} from './billing-cleanup';
import { advanceCleanup } from './billing-cleanup-lifecycle';
import {
  at,
  context,
  initial,
  changed,
  claimed,
  page,
  empty,
  otherJob,
  first,
  second,
} from './billing-cleanup.test-support';
setupRitewayBun();
test('bounded cleanup interleaves lanes and durably retains selected page remainder and invoice authority', () => {
  const p1 = 'p'.repeat(24),
    p2 = 'q'.repeat(24);
  let value = claimed(initial(), 0);
  value = changed(value, page(value, [p1, p2], true), 0.1);
  const purchase = value.kind === 'scanning' ? value.scans.purchases : null;
  value = claimed(value, 2);
  value = changed(value, page(value, ['sub_original'], true), 2.1);
  value = claimed(value, 4);
  value = changed(value, page(value, ['in_original'], true), 4.1);
  value = empty(value, 6);
  value = empty(value, 8);
  value = claimed(value, 10);
  value = changed(
    value,
    { kind: 'resolved', claimId: first, work: cleanupWork(value)! },
    10.1,
  );
  const remaining = value.kind === 'scanning' ? value.scans.purchases : null;
  value = claimed(value, 12);
  value = changed(
    value,
    { kind: 'resolved', claimId: first, work: cleanupWork(value)! },
    12.1,
  );
  value = claimed(value, 14);
  value = changed(
    value,
    {
      kind: 'failure',
      claimId: first,
      work: cleanupWork(value)!,
      retryAt: at(16),
    },
    14.1,
  );
  assert({
    given:
      'subscription and purchase pages with pending work, a multi-page invoice and an empty refund scan',
    should:
      'yield among lanes without dropping selected resources or inventing invoice coverage',
    actual: [
      purchase,
      remaining,
      value.kind === 'scanning' && value.turn,
      value.kind === 'scanning' && value.scans.invoices,
      value.kind === 'scanning' && value.scans.subscriptions,
    ],
    expected: [
      {
        kind: 'selected',
        id: p1,
        rest: [p2],
        lastId: p2,
        more: true,
        detail: { kind: 'resource' },
      },
      {
        kind: 'selected',
        id: p2,
        rest: [],
        lastId: p2,
        more: true,
        detail: { kind: 'resource' },
      },
      'purchases',
      {
        kind: 'selected',
        id: 'in_original',
        rest: [],
        lastId: 'in_original',
        more: true,
        detail: { kind: 'invoice-payments', pass: null },
      },
      { kind: 'page', afterId: 'sub_original' },
    ],
  });
});

test('every outcome is fenced by exact job, claim, phase/cursor and expiry without mutating stale state', () => {
  const value = claimed(initial(), 0),
    before = JSON.stringify(value),
    work = cleanupWork(value)!;
  const events: Exclude<CleanupEvent, { kind: 'claim' }>[] = [
    page(value, []),
    { kind: 'failure', claimId: first, work, retryAt: at(60) },
    { kind: 'deleted', claimId: first, work },
  ];
  const outcomes = events.flatMap((event) => [
    advanceCleanup(value, event, { ...context(1), jobId: otherJob }),
    advanceCleanup(value, event, { ...context(1), closed: false }),
    advanceCleanup(value, event, context(30)),
    advanceCleanup(value, { ...event, claimId: second }, context(1)),
    advanceCleanup(
      value,
      {
        ...event,
        work: {
          kind: 'scan',
          lane: 'purchases',
          scan: { kind: 'page', afterId: 'x'.repeat(24) },
        },
      },
      context(1),
    ),
  ]);
  assert({
    given:
      'old progress, retry or completion against replacement authority, changed cursor or expired token',
    should: 'return idle with identical state and no due/attempt mutation',
    actual: [outcomes, JSON.stringify(value)],
    expected: [Array(15).fill({ kind: 'idle' }), before],
  });
});

test('progress schedules fixed due independently of prior failure and cannot refresh the consumed authority', () => {
  const c = claimed(initial(), 0);
  const failed = changed(
    c,
    {
      kind: 'failure',
      claimId: first,
      work: cleanupWork(c)!,
      retryAt: at(3600),
    },
    1,
  );
  const retry = claimed(failed, 3600, second);
  const progressed = advanceCleanup(
    retry,
    page(retry, [], false, second),
    context(3600.1),
  );
  if (progressed.kind === 'idle') throw Error('Progress fixture refused');
  assert({
    given: 'ordinary failure backoff followed by real durable progress',
    should: 'use a fixed one-second due, consume authority, and reject replay',
    actual: [
      progressed.kind,
      'retryAt' in progressed.state && progressed.state.retryAt,
      'claim' in progressed.state && progressed.state.claim,
      advanceCleanup(
        progressed.state,
        page(retry, [], false, second),
        context(3600.2),
      ),
    ],
    expected: ['progress', at(3601.1), null, { kind: 'idle' }],
  });
});

test('empty scans do not erase unresolved work and only verified deletion can acknowledge a complete scan cycle', () => {
  let pending = claimed(initial(), 0);
  pending = changed(pending, page(pending, ['p'.repeat(24)]), 0.1);
  const blocked = advanceCleanup(
    claimed(pending, 2),
    { kind: 'deleted', claimId: first, work: { kind: 'delete' } },
    context(2.1),
  );
  let clear = initial();
  for (const time of [0, 2, 4, 6, 8]) clear = empty(clear, time);
  const deletion = claimed(clear, 10);
  const complete = advanceCleanup(
    deletion,
    { kind: 'deleted', claimId: first, work: cleanupWork(deletion)! },
    {
      ...context(10.1),
      effects: {
        mappedCustomers: 0,
        possiblePurchases: 0,
        retainedFinancialRoutes: 0,
        owedFinancialEffects: false,
      },
    },
  );
  assert({
    given:
      'one unresolved selected resource, then a separate truly empty cycle with verified cancellation scan and deletion',
    should:
      'refuse early completion and acknowledge only the exact current deletion result',
    actual: [
      blocked,
      clear.kind,
      complete.kind,
      complete.kind !== 'idle' && complete.state.kind,
      complete.kind !== 'idle' &&
        advanceCleanup(
          complete.state,
          { kind: 'claim', claimId: second },
          context(11),
        ),
    ],
    expected: [
      { kind: 'idle' },
      'deleting',
      'complete',
      'acknowledged',
      { kind: 'idle' },
    ],
  });
});

test('malformed, duplicate, oversized and nonprogress pages cannot skip financial resources', () => {
  const value = claimed(initial(), 0);
  const pages = [
    page(value, [], true),
    page(value, Array(21).fill('p'.repeat(24))),
    page(value, ['p'.repeat(24), 'p'.repeat(24)]),
    page(value, ['sub_foreign']),
  ];
  assert({
    given:
      'invalid bounded resource pages or corrupted persisted lane identity',
    should: 'refuse all without moving the durable cursor',
    actual: [
      pages.map((event) => advanceCleanup(value, event, context(1))),
      billingCleanupSchema.safeParse({
        ...value,
        scans: {
          ...('scans' in value ? value.scans : {}),
          purchases: { kind: 'page', afterId: 'sub_foreign' },
        },
      }).success,
    ],
    expected: [Array(4).fill({ kind: 'idle' }), false],
  });
});
