import { roundIncidentPolicy } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { CAPTURE_OUTAGE_BUDGET_MS } from './capture-memory';
setupRitewayBun();

test('capture outlasts a platform incident', () => {
  assert({
    given: 'the longest a Round can be held before its clock runs',
    should: 'leave capture holding its audio, so it need not relaunch',
    actual:
      CAPTURE_OUTAGE_BUDGET_MS >
      roundIncidentPolicy.recoveryBoundMs +
        roundIncidentPolicy.resumeCountdownMs,
    expected: true,
  });
});
