import { assert, setupRitewayBun, test } from 'riteway/bun';
import { cleanupWork } from './billing-cleanup';
import { advanceCleanup } from './billing-cleanup-lifecycle';
import {
  initial,
  claimed,
  changed,
  page,
  empty,
  context,
  first,
  second,
} from './billing-cleanup.test-support';
setupRitewayBun();
test('a crashed selected-resource attempt replays its exact identity and rejects old completion after replacement claim', () => {
  const ids = ['p'.repeat(24), 'q'.repeat(24)];
  let value = claimed(initial(), 0);
  value = changed(value, page(value, ids, true), 0.1);
  for (const time of [2, 4, 6]) value = empty(value, time);
  const old = claimed(value, 8),
    work = cleanupWork(old)!;
  const replacement = claimed(old, 38, second);
  const stale = advanceCleanup(
    replacement,
    { kind: 'resolved', claimId: first, work },
    context(38.1),
  );
  const fresh = changed(
    replacement,
    { kind: 'resolved', claimId: second, work },
    38.2,
  );
  assert({
    given:
      'a worker disappears after durable selection and a new worker acquires the expired attempt',
    should:
      'replay the original selected resource, reject its old reply and advance only one remaining item',
    actual: [
      cleanupWork(replacement),
      stale,
      fresh.kind === 'scanning' && fresh.scans.purchases,
    ],
    expected: [
      work,
      { kind: 'idle' },
      {
        kind: 'selected',
        id: ids[1],
        rest: [],
        lastId: ids[1],
        more: true,
        detail: { kind: 'resource' },
      },
    ],
  });
});

test('missing customer mapping alone never acknowledges unknown purchase or retained financial work', () => {
  const value = claimed(initial(), 0),
    event = {
      kind: 'no-effects' as const,
      claimId: first,
      work: cleanupWork(value)!,
    };
  const effects = [
    undefined,
    { mappedCustomers: 0, possiblePurchases: 1, retainedFinancialRoutes: 0 },
    { mappedCustomers: 0, possiblePurchases: 0, retainedFinancialRoutes: 1 },
    { mappedCustomers: 1, possiblePurchases: 0, retainedFinancialRoutes: 0 },
  ];
  const empty = {
    mappedCustomers: 0,
    possiblePurchases: 0,
    retainedFinancialRoutes: 0,
  };
  const valid = advanceCleanup(value, event, { ...context(1), effects: empty });
  assert({
    given:
      'no live customer mapping, unknown purchase or retained refund route, then positively proved absence of all effects under current authority',
    should:
      'retain every unknown/financial obligation and acknowledge only the fenced zero-effects case',
    actual: [
      effects.map((facts) =>
        advanceCleanup(value, event, {
          ...context(1),
          ...(facts === undefined ? {} : { effects: facts }),
        }),
      ),
      valid.kind,
      valid.kind !== 'idle' &&
        valid.state.kind === 'acknowledged' &&
        valid.state.outcome,
      advanceCleanup(value, event, {
        ...context(1),
        effects: empty,
        jobId: 'z'.repeat(24),
      }),
    ],
    expected: [
      Array(4).fill({ kind: 'idle' }),
      'complete',
      'no-vendor-effects',
      { kind: 'idle' },
    ],
  });
});
