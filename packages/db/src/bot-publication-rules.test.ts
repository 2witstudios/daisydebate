import { instantMs } from '@daisy/clock';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  nextPublicationClaim,
  publicationClaim,
} from './bot-publication-rules';

setupRitewayBun();

const nowMs = instantMs('2026-10-22T12:00:00.000Z');

const now = new Date(nowMs);
const target = {
  roundId: 'round',
  roundParticipantId: 'seat',
  segmentId: 'segment',
};

test('a new claim waits for the previous lease, then takes the next epoch', async () => {
  assert({
    given: 'no previous claim, and one whose lease expired exactly now',
    should: 'start at epoch 1, then advance the previous epoch',
    actual: [
      nextPublicationClaim(undefined, now),
      nextPublicationClaim({ leaseExpiresAt: now, publicationEpoch: 4 }, now),
    ],
    expected: [1, 5],
  });
  await assertRejects({
    given: 'a previous claim whose lease is still live',
    should: 'refuse the new claim',
    actual: () =>
      nextPublicationClaim(
        { leaseExpiresAt: new Date(nowMs + 1), publicationEpoch: 4 },
        now,
      ),
    code: 'CONFLICT',
  });
});

test('a claim binds one run, its own service and a lease from now', () => {
  const claim = publicationClaim({
    target,
    agentRunId: 'run',
    epoch: 5,
    leaseTokenDigest: 'digest',
    now,
    leaseMs: 15000,
  });
  assert({
    given: 'a run, epoch, token digest and lease length',
    should: 'scope the run, configure it identically and store the lease',
    actual: claim,
    expected: {
      scope: {
        ...target,
        agentRunId: 'run',
        serviceId: 'agent-run:run',
        publicationEpoch: 5,
      },
      configuration: {
        ...target,
        serviceId: 'agent-run:run',
        publicationEpoch: 5,
      },
      row: {
        ...target,
        agentRunId: 'run',
        serviceId: 'agent-run:run',
        publicationEpoch: 5,
        leaseTokenDigest: 'digest',
        leaseExpiresAt: new Date('2026-10-22T12:00:15.000Z'),
      },
    },
  });
});
