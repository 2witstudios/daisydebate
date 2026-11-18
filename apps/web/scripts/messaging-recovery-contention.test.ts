import { assert, setupRitewayBun, test } from 'riteway/bun';
import { refuseCapacity } from '@daisy/db/testing';
import { isLaneContention } from '../e2e/support/messaging-recovery-control';
setupRitewayBun();

test('only a setup lost wholly to the social lane wait is contention', () => {
  const expired = () => refuseCapacity({ lane: 'social', reason: 'expired' });
  assert({
    given:
      'every entry social.expired, a mix with a holder fault, no entries, and a bare refusal',
    should: 'retry the first alone',
    actual: [
      isLaneContention(new AggregateError([expired(), expired()])),
      isLaneContention(
        new AggregateError([expired(), new Error('holder fault')]),
      ),
      isLaneContention(new AggregateError([])),
      isLaneContention(expired()),
    ],
    expected: [true, false, false, false],
  });
  assert({
    given: 'an expiry on another lane, or saturation on the social lane',
    should: 'not count as social-lane contention',
    actual: [
      isLaneContention(
        new AggregateError([
          refuseCapacity({ lane: 'competitive', reason: 'expired' }),
        ]),
      ),
      isLaneContention(
        new AggregateError([
          refuseCapacity({ lane: 'social', reason: 'saturated' }),
        ]),
      ),
    ],
    expected: [false, false],
  });
});
