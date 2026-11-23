import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireSameCheckIn } from './attendance-operations';
setupRitewayBun();

test('a replayed check-in must match its receipt', async () => {
  const receipt = { segmentId: 'ac', participantId: 'aff' };
  assert({
    given: 'the same segment and seat',
    should: 'admit the replay',
    actual: requireSameCheckIn(receipt, { ...receipt }),
    expected: undefined,
  });
  for (const expected of [
    { segmentId: 'nc', participantId: 'aff' },
    { segmentId: 'ac', participantId: 'neg' },
  ])
    await assertRejects({
      given: `a replay for ${JSON.stringify(expected)}`,
      should: 'refuse the reused command id',
      actual: () => requireSameCheckIn(receipt, expected),
      code: 'CONFLICT',
    });
});
