import { assert, setupRitewayBun, test } from 'riteway/bun';
import { reconcileFacts } from './reconcile-facts';

setupRitewayBun();

const broadcast = {
  egressId: 'EG',
  releasePolicy: { kind: 'delay', seconds: 60 } as const,
  observerRevokedAt: new Date(5000),
  revocationFailures: 2,
  stoppedAt: null,
  completedAt: null,
  finalMediaEndAt: new Date(7000),
  releasedThroughAt: new Date(6000),
};

test('reconcileFacts maps stored state to the decision input', () => {
  const facts = reconcileFacts({
    nowMs: 9000,
    broadcast,
    roundStatus: 'active',
    roundEndedAt: null,
    position: {
      status: 'active',
      openSegment: null,
      nextSegment: null,
      prep: { side: 'affirmative' },
      awaitingBallot: false,
    },
    egress: { kind: 'active', id: 'EG' },
  });
  assert({
    given: 'a Broadcast in prep whose observer is revoked',
    should: 'report the private phase, no subscription, and millisecond times',
    actual: [
      facts.phase,
      facts.observerSubscribed,
      facts.revocationFailures,
      facts.finalMediaEndMs,
      facts.releasedThroughMs,
      facts.stoppedAtMs,
    ],
    expected: [{ kind: 'private' }, false, 2, 7000, 6000, null],
  });
});
