import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireRetentionBounds } from './availability-operations';

setupRitewayBun();

const before = '2026-10-22T12:00:00.000Z';

test('a retention purge needs a parseable horizon and a bounded batch', async () => {
  assert({
    given: 'the smallest and largest batches',
    should: 'admit both',
    actual: [1, 1000].map((limit) => requireRetentionBounds({ before, limit })),
    expected: [undefined, undefined],
  });
  for (const [label, input] of [
    ['an unparseable horizon', { before: 'yesterday', limit: 10 }],
    ['an empty batch', { before, limit: 0 }],
    ['an oversized batch', { before, limit: 1001 }],
    ['a fractional batch', { before, limit: 2.5 }],
  ] as const)
    await assertRejects({
      given: label,
      should: 'refuse before any delete',
      actual: () => requireRetentionBounds(input),
      code: 'VALIDATION',
    });
});
