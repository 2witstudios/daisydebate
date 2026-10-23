import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  nextPublicationClaim,
  publicationClaim,
  requirePublishingSeat,
} from './bot-publication-rules';

setupRitewayBun();

const now = new Date('2026-10-22T12:00:00.000Z');
const target = {
  roundId: 'round',
  roundParticipantId: 'seat',
  segmentId: 'segment',
};

test('bots publish only for a debating seat of an active Round', async () => {
  assert({
    given: 'a debating seat in an active Round',
    should: 'admit the claim',
    actual: requirePublishingSeat({ status: 'active' }, { role: 'negative' }),
    expected: undefined,
  });
  for (const [status, role] of [
    ['scheduled', 'negative'],
    ['completed', 'affirmative'],
    ['active', 'judge'],
  ] as const)
    await assertRejects({
      given: `a ${role} seat in a ${status} Round`,
      should: 'refuse publication authority',
      actual: () => requirePublishingSeat({ status }, { role }),
      code: 'AUTHORIZATION',
    });
});

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
        { leaseExpiresAt: new Date(now.getTime() + 1), publicationEpoch: 4 },
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
