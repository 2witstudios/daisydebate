import { assert, setupRitewayBun, test } from 'riteway/bun';
import { nextWaitMs, validateIdleBackoff } from './backoff';

setupRitewayBun();

const backoff = { busyMs: 500, idleMaxMs: 8_000 };

test('empty passes double the wait up to the cap', () => {
  const waits: number[] = [];
  let previous: number | null = null;
  for (let pass = 0; pass < 7; pass += 1) {
    previous = nextWaitMs(backoff, previous, 'idle');
    waits.push(previous);
  }
  assert({
    given: 'seven empty passes from a start',
    should: 'wait the busy interval first, then double to the idle cap',
    actual: waits,
    expected: [500, 1_000, 2_000, 4_000, 8_000, 8_000, 8_000],
  });
});

test('found work returns to the busy interval at once', () => {
  assert({
    given: 'a pass that found work after a long idle wait',
    should: 'wait only the busy interval',
    actual: nextWaitMs(backoff, 8_000, 'worked'),
    expected: 500,
  });
});

test('a failed pass backs off like an empty one', () => {
  assert({
    given: 'a failing store',
    should: 'grow the wait, never hammer it',
    actual: nextWaitMs(backoff, 1_000, 'failed'),
    expected: 2_000,
  });
});

test('a custom factor grows the wait by that factor', () => {
  assert({
    given: 'factor 4',
    should: 'quadruple and cap',
    actual: [
      nextWaitMs({ ...backoff, factor: 4 }, 500, 'idle'),
      nextWaitMs({ ...backoff, factor: 4 }, 4_000, 'idle'),
    ],
    expected: [2_000, 8_000],
  });
});

test('a schedule that would spin or never back off is refused', () => {
  const refused = [
    { busyMs: 0, idleMaxMs: 1_000 },
    { busyMs: 1_000, idleMaxMs: 500 },
    { busyMs: 500, idleMaxMs: 1_000, factor: 1 },
    { busyMs: 0.5, idleMaxMs: 1_000 },
  ].map((schedule) => {
    try {
      validateIdleBackoff(schedule);
      return false;
    } catch {
      return true;
    }
  });
  assert({
    given: 'a zero, inverted, non-growing or fractional schedule',
    should: 'refuse each',
    actual: refused,
    expected: [true, true, true, true],
  });
});
