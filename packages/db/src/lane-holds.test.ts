import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createHoldLedger } from './lane-holds';

setupRitewayBun();

test('a ledger summarises each operation and starts again once drained', () => {
  const ledger = createHoldLedger();
  ledger.record('claim', 4);
  ledger.record('claim', 40);
  ledger.record('read', 900);
  assert({
    given: 'holds by two operations',
    should: 'report count, total, maximum and a p95 upper bound for each',
    actual: ledger.drain(),
    expected: [
      { operation: 'claim', count: 2, totalMs: 44, maxMs: 40, p95Ms: 40 },
      { operation: 'read', count: 1, totalMs: 900, maxMs: 900, p95Ms: 900 },
    ],
  });
  assert({
    given: 'a second drain with nothing new',
    should: 'report nothing',
    actual: ledger.drain(),
    expected: [],
  });
});

test('p95 reads the bucket holding the 95th hold, not the outlier', () => {
  const ledger = createHoldLedger();
  for (let hold = 0; hold < 99; hold += 1) ledger.record('claim', 8);
  ledger.record('claim', 4_000);
  const [summary] = ledger.drain();
  assert({
    given: '99 short holds and one long one',
    should: 'bound p95 by the short bucket and keep the long hold as maximum',
    actual: { p95Ms: summary?.p95Ms, maxMs: summary?.maxMs },
    expected: { p95Ms: 10, maxMs: 4_000 },
  });
});

test('a fractional hold is whole milliseconds, as a log count must be', () => {
  const ledger = createHoldLedger();
  ledger.record('claim', 2.4);
  ledger.record('claim', 2.4);
  assert({
    given: 'two holds of 2.4 ms from a monotonic clock',
    should: 'report whole milliseconds',
    actual: ledger.drain(),
    expected: [
      { operation: 'claim', count: 2, totalMs: 5, maxMs: 3, p95Ms: 3 },
    ],
  });
});
