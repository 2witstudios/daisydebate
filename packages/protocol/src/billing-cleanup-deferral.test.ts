import { assert, setupRitewayBun, test } from 'riteway/bun';
import { cleanupWork } from './billing-cleanup';
import { advanceCleanup } from './billing-cleanup-lifecycle';
import {
  at,
  context,
  initial,
  claimed,
  changed,
  page,
  first,
} from './billing-cleanup.test-support';
setupRitewayBun();
function selectedLanes() {
  let value = initial();
  const ids = ['p'.repeat(24), 'sub_known', 'in_known', 'r'.repeat(24)];
  for (let index = 0; index < 4; index++) {
    const c = claimed(value, index * 2);
    value = changed(c, page(c, [ids[index]!]), index * 2 + 0.1);
  }
  return value;
}
test('repeated failed current attempts yield fairly while preserving every owed selection and rejecting stale replies', () => {
  let value = selectedLanes();
  if (value.kind !== 'scanning') throw Error('Expected selected scans');
  const original = value.scans,
    turns: unknown[] = [],
    kinds: unknown[] = [];
  let stale: unknown;
  for (let index = 0; index < 4; index++) {
    const time = 8 + index * 2,
      c = claimed(value, time);
    const event = {
      kind: 'failure' as const,
      claimId: first,
      work: cleanupWork(c)!,
      retryAt: at(time + 2),
    };
    const next = advanceCleanup(c, event, context(time + 0.1));
    kinds.push(next.kind);
    if (next.kind === 'idle') throw Error('Expected failure transition');
    value = next.state;
    turns.push(value.kind === 'scanning' && value.turn);
    stale = advanceCleanup(value, event, context(time + 0.2));
  }
  assert({
    given:
      'an uncertain purchase and three known selected financial resources, with four failed current attempts',
    should:
      'visit every lane once while retaining all original cursors/identities, ordinary failure scheduling and stale refusal',
    actual: [
      kinds,
      turns,
      value.kind === 'scanning' && value.scans,
      value.kind !== 'acknowledged' && value.retryAt,
      stale,
    ],
    expected: [
      Array(4).fill('failure'),
      ['subscriptions', 'invoices', 'refunds', 'purchases'],
      original,
      at(16),
      { kind: 'idle' },
    ],
  });
});
test('an unresolved purchase does not prevent other selected financial cleanup from progressing', () => {
  let value = selectedLanes();
  const c = claimed(value, 8);
  value = changed(
    c,
    { kind: 'failure', claimId: first, work: cleanupWork(c)!, retryAt: at(10) },
    8.1,
  );
  const visited: unknown[] = [];
  for (const time of [10, 12, 14]) {
    const current = claimed(value, time),
      work = cleanupWork(current)!;
    visited.push(work.kind === 'scan' && work.lane);
    value = changed(
      current,
      work.kind === 'scan' && work.lane === 'invoices'
        ? {
            kind: 'payments',
            claimId: first,
            work,
            beforeId: null,
            afterId: null,
            exhausted: true,
          }
        : { kind: 'resolved', claimId: first, work },
      time + 0.1,
    );
  }
  const scans = value.kind === 'scanning' && value.scans;
  assert({
    given:
      'one deferred uncertain purchase and successful known cancellation/payment/refund work',
    should:
      'retain the owed purchase and complete only other positively resolved selections',
    actual: [visited, value.kind === 'scanning' && value.turn, scans],
    expected: [
      ['subscriptions', 'invoices', 'refunds'],
      'purchases',
      {
        purchases: {
          kind: 'selected',
          id: 'p'.repeat(24),
          rest: [],
          lastId: 'p'.repeat(24),
          more: false,
          detail: { kind: 'resource' },
        },
        subscriptions: { kind: 'complete' },
        invoices: { kind: 'complete' },
        refunds: { kind: 'complete' },
      },
    ],
  });
});
