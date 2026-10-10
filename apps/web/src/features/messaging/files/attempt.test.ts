import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireFileAttempt } from './attempt';
setupRitewayBun();
test('late scan results cannot extend the file service lease', async () => {
  const start = '2026-10-09T18:00:00.000Z';
  assert({
    given: 'an on-time complete scan attempt',
    should: 'retain its original deadline',
    actual: requireFileAttempt(start, '2026-10-09T18:00:00.099Z', 100),
    expected: undefined,
  });
  for (const now of [
    '2026-10-09T18:00:00.100Z',
    '2026-10-09T17:59:59.999Z',
    'invalid',
  ])
    await assertRejects({
      given: 'a late result, backwards clock or invalid time',
      should: 'reject attachment before commit',
      actual: () => requireFileAttempt(start, now, 100),
      code: 'CONFLICT',
    });
});
