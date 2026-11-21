import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireRetentionBounds } from './retention';

setupRitewayBun();

test('retention refuses invalid batch bounds', () => {
  const before = '2026-09-19T00:00:00.000Z';
  const received = [0, -1, 1.5, 501]
    .map((limit) => ({ before, limit }))
    .concat({ before: 'not a date', limit: 5 })
    .map((input) => {
      try {
        requireRetentionBounds(input);
        return 'accepted';
      } catch {
        return 'refused';
      }
    });
  assert({
    given: 'zero, negative, fractional, oversized, or invalid-date bounds',
    should: 'refuse every batch',
    actual: received,
    expected: Array(5).fill('refused'),
  });
});
