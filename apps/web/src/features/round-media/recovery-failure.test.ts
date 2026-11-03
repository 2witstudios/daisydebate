import { assert, setupRitewayBun, test } from 'riteway/bun';
import { refuseCapacity } from '@daisy/db/testing';
import { recoveryFailureFields } from './recovery-failure';
setupRitewayBun();

test('recovery failure fields name what stopped the work', () => {
  assert({
    given: 'a lane refusal',
    should: 'name the lane and the reason',
    actual: recoveryFailureFields(
      refuseCapacity({ lane: 'competitive', reason: 'saturated' }),
    ).cause,
    expected: 'competitive.saturated',
  });
  assert({
    given: 'anything else',
    should: 'say internal, with no raw error',
    actual: recoveryFailureFields(new Error('secret detail')),
    expected: { cause: 'internal' },
  });
});
