import { assert, setupRitewayBun, test } from 'riteway/bun';
import { captureEligibility } from './eligibility';

setupRitewayBun();

test('captureEligibility', () => {
  const casual = {
    competitionType: 'casual',
    hostActorId: 'host',
    hostOptedIn: true,
    hostHoldsRecording: true,
    youthRound: false,
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
    given: 'a ranked Round on Youth – Freestyle',
    should: 'capture it as a Youth Recording (ADR 0150)',
    actual: captureEligibility({
      ...casual,
      competitionType: 'ranked',
      youthRound: true,
    }),
    expected: { kind: 'ranked', youth: true },
  });
  assert({
    given: 'a casual Round in a Youth Room whose entitled host opted in',
    should:
      'capture under the host opt-in: the Round is private by its Room (ADR 0157), and participants may remove a casual Recording',
    actual: captureEligibility({ ...casual, youthRound: true }),
    expected: { kind: 'host_opt_in', hostActorId: 'host' },
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
