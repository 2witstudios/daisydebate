import { assert, setupRitewayBun, test } from 'riteway/bun';
import { captureEligibility } from './eligibility';

setupRitewayBun();

test('captureEligibility', () => {
  const casual = {
    competitionType: 'casual',
    hostActorId: 'host',
    hostOptedIn: true,
    hostHoldsRecording: true,
  } as const;
  assert({
    given: 'a ranked Round with no opt-in and no entitlement',
    should: 'always capture',
    actual: captureEligibility({
      ...casual,
      competitionType: 'ranked',
      hostOptedIn: false,
      hostHoldsRecording: false,
    }),
    expected: { kind: 'ranked' },
  });
  assert({
    given: 'a casual Round whose entitled host opted in',
    should: 'capture, naming the host',
    actual: captureEligibility(casual),
    expected: { kind: 'host_opt_in', hostActorId: 'host' },
  });
  assert({
    given: 'a casual Round missing either condition',
    should: 'not capture',
    actual: [
      captureEligibility({ ...casual, hostOptedIn: false }),
      captureEligibility({ ...casual, hostHoldsRecording: false }),
      captureEligibility({ ...casual, hostActorId: null }),
    ],
    expected: [null, null, null],
  });
});
