import { assert, setupRitewayBun, test } from 'riteway/bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from './index.test-support';
import { deleteExpiredOutboxPrefix } from './outbox-retention';
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

test('public outbox retention deletes a certified prefix and advances its boundary in one statement', async () => {
  const { client, queries } = fakeSql([[{ known: true, count: 2 }]]);
  const count = await deleteExpiredOutboxPrefix(drizzle({ client }), {
    before: '2026-09-19T00:00:00.000Z',
    limit: 500,
  });
  const text = queries[0]?.query ?? '';
  assert({
    given: 'a public outbox purge with a known durable boundary',
    should:
      'return the deleted count through one atomic final-prefix statement without skipping locks',
    actual: {
      count,
      statements: queries.length,
      maintenance: text.includes('public.daisy_prune_outbox_prefix'),
      bounded: queries[0]?.params.includes(500),
    },
    expected: {
      count: 2,
      statements: 1,
      maintenance: true,
      bounded: true,
    },
  });
});
