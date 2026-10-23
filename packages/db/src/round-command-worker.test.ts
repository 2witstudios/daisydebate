import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundCommandWorkerActive } from './round-command-worker';

setupRitewayBun();

const now = '2026-10-22T12:00:10.000Z';
const principal = {
  kind: 'agent' as const,
  roundId: 'round',
  participantId: 'seat',
  agentRunId: 'run',
  serviceId: 'agent-run:run',
  publicationEpoch: 3,
};
const claim = {
  segmentId: 'segment',
  agentRunId: 'run',
  serviceId: 'agent-run:run',
  publicationEpoch: 3,
  leaseExpiresAt: new Date('2026-10-22T12:00:11.000Z'),
};
const configuration = {
  roundId: 'round',
  roundParticipantId: 'seat',
  segmentId: 'segment',
  serviceId: 'agent-run:run',
  publicationEpoch: 3,
};
const segment = {
  id: 'segment',
  startedAt: '2026-10-22T12:00:00.000Z',
  endedAt: null,
  durationMs: 60_000,
};
const round = { id: 'round', status: 'active' as const, segments: [segment] };
const input = {
  principal,
  claim,
  kind: 'speech',
  configuration,
  round,
  now,
};

test('a worker is active only with its durable claim, run and current segment', () => {
  assert({
    given: 'the bound speech worker inside its lease and live segment',
    should: 'be active, for cross-examination too and after the Round ends',
    actual: [
      roundCommandWorkerActive(input),
      roundCommandWorkerActive({ ...input, kind: 'cross_ex' }),
      roundCommandWorkerActive({
        ...input,
        round: { ...round, status: 'completed', segments: [] },
      }),
    ],
    expected: [true, true, true],
  });
});

test('any missing, mismatched or stale binding deactivates the worker', () => {
  const variants = {
    human: { principal: { kind: 'human' as const, actorId: 'actor' } },
    'no claim': { claim: null },
    'no configuration': { configuration: null },
    'judging run': { kind: 'judging' },
    'another segment': { configuration: { ...configuration, segmentId: 'x' } },
    'older epoch': { configuration: { ...configuration, publicationEpoch: 2 } },
    'another run': { claim: { ...claim, agentRunId: 'other' } },
    'foreign service': {
      claim: { ...claim, serviceId: 'agent-run:other' },
    },
    'expired lease': { now: '2026-10-22T12:00:11.000Z' },
    'ended segment': {
      round: { ...round, segments: [{ ...segment, endedAt: now }] },
    },
    'later segment': {
      round: { ...round, segments: [segment, { ...segment, id: 'next' }] },
    },
    'before start': { now: '2026-10-22T11:59:59.999Z' },
    'past duration': {
      now: '2026-10-22T12:01:00.000Z',
      claim: {
        ...claim,
        leaseExpiresAt: new Date('2026-10-22T12:02:00.000Z'),
      },
    },
    'no segment': { round: { ...round, segments: [] } },
  };
  assert({
    given: 'each single broken binding',
    should: 'refuse activity',
    actual: Object.fromEntries(
      Object.entries(variants).map(([name, change]) => [
        name,
        roundCommandWorkerActive({ ...input, ...change }),
      ]),
    ),
    expected: Object.fromEntries(
      Object.keys(variants).map((name) => [name, false]),
    ),
  });
});
