import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createHoldLedger } from './workload';

setupRitewayBun();

test('a ledger summarises the lane and each operation, then starts again', () => {
  const ledger = createHoldLedger();
  ledger.record('claim', 4);
  ledger.record('claim', 40);
  ledger.record('read', 900);
  assert({
    given: 'holds by two operations',
    should:
      'report count, total, maximum and a p95 bound for the lane and each',
    actual: ledger.drain(),
    expected: {
      total: { count: 3, totalMs: 944, maxMs: 900, p95Ms: 900, waits: 0 },
      operations: [
        {
          operation: 'claim',
          count: 2,
          totalMs: 44,
          maxMs: 40,
          p95Ms: 40,
          waits: 0,
        },
        {
          operation: 'read',
          count: 1,
          totalMs: 900,
          maxMs: 900,
          p95Ms: 900,
          waits: 0,
        },
      ],
    },
  });
  assert({
    given: 'a second drain with nothing new',
    should: 'report an empty lane and no operations',
    actual: ledger.drain(),
    expected: {
      total: { count: 0, totalMs: 0, maxMs: 0, p95Ms: 0, waits: 0 },
      operations: [],
    },
  });
});

test('p95 reads the bucket holding the 95th hold, not the outlier', () => {
  const ledger = createHoldLedger();
  for (let hold = 0; hold < 99; hold += 1) ledger.record('claim', 8);
  ledger.record('claim', 4_000);
  const { total, operations } = ledger.drain();
  assert({
    given: '99 short holds and one long one',
    should: 'bound p95 by the short bucket and keep the long hold as maximum',
    actual: { p95Ms: operations[0]?.p95Ms, maxMs: operations[0]?.maxMs },
    expected: { p95Ms: 10, maxMs: 4_000 },
  });
  assert({
    given: 'the same holds as the whole lane',
    should: 'bound the lane p95 the same way',
    actual: { p95Ms: total.p95Ms, maxMs: total.maxMs },
    expected: { p95Ms: 10, maxMs: 4_000 },
  });
});

test('the lane p95 spans every hold, not the worst operation bound', () => {
  const ledger = createHoldLedger();
  for (let hold = 0; hold < 95; hold += 1) ledger.record('claim', 3);
  for (let hold = 0; hold < 5; hold += 1) ledger.record('scan', 800);
  assert({
    given: '95 short claims and 5 long scans',
    should: 'bound the lane p95 by the short bucket',
    actual: ledger.drain().total,
    expected: { count: 100, totalMs: 4_285, maxMs: 800, p95Ms: 5, waits: 0 },
  });
});

test('a fractional hold is whole milliseconds, as a log count must be', () => {
  const ledger = createHoldLedger();
  ledger.record('claim', 2.4);
  ledger.record('claim', 2.4);
  assert({
    given: 'two holds of 2.4 ms from a monotonic clock',
    should: 'report whole milliseconds',
    actual: ledger.drain().operations,
    expected: [
      {
        operation: 'claim',
        count: 2,
        totalMs: 5,
        maxMs: 3,
        p95Ms: 3,
        waits: 0,
      },
    ],
  });
});

test('a hold that queued for the lane counts as a wait, for it and the lane', () => {
  const ledger = createHoldLedger();
  ledger.record('claim', 3, true);
  ledger.record('claim', 3);
  ledger.record('read', 3);
  const { total, operations } = ledger.drain();
  assert({
    given: 'one queued claim among three holds',
    should: 'count one wait on the claim and on the lane',
    actual: {
      lane: total.waits,
      byOperation: operations.map(({ operation, waits }) => [operation, waits]),
    },
    expected: {
      lane: 1,
      byOperation: [
        ['claim', 1],
        ['read', 0],
      ],
    },
  });
});
