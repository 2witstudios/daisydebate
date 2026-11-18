import { lockedRound } from '../round-runtime/locked-round.test-support';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createBroadcastSweep } from './sweep';

setupRitewayBun();

type Deps = Parameters<typeof createBroadcastSweep>[0];
const open = (over = {}) => ({
  id: 'b1',
  roundId: 'r1',
  egressId: null,
  egressDispatchedAt: null,
  egressSettledAt: null,
  egressGeneration: 0,
  stageCredentialHash: null,
  releasePolicy: { kind: 'delay', seconds: 60 } as const,
  observerRevokedAt: null,
  revocationFailures: 0,
  stoppedAt: null,
  completedAt: null,
  finalMediaEndAt: null,
  releasedThroughAt: null,
  ...over,
});
const world = (over: Partial<Record<string, unknown>> = {}) => {
  const log: string[] = [];
  const store = {
    discoverUnopened: async () => [],
    endYouthBroadcasts: async () => [] as string[],
    open: async (input: {
      roundId: string;
      feedKey: string;
      releasePolicy: unknown;
    }) => {
      log.push(
        `open ${input.roundId} ${input.feedKey} ${JSON.stringify(input.releasePolicy)}`,
      );
    },
    listOpen: async () => [] as unknown[],
    readRound: async () => null as unknown,
    claimReconcile: async () => true,
    beginEgressAttempt: async () => {
      log.push('begin');
      return true;
    },
    settleEgressAttempt: async () => true,
    recordEgressStarted: async (input: {
      egressId: string;
      stageCredentialHash: string;
    }) => {
      log.push(`recorded ${input.egressId} ${input.stageCredentialHash}`);
      return true;
    },
    ...over,
  };
  const deps = {
    store,
    newFeedKey: () => 'random-key',
    egress: {
      start: async (input: { stageUrl: string; holdPrefix: string }) => {
        log.push(`start ${input.stageUrl} ${input.holdPrefix}`);
        return 'EG';
      },
    },
    now: () => 1_000_000,
    nextId: () => 'generated',
    newCredential: () => ({ secret: 'SECRET', hash: 'HASH' }),
    stageUrl: (id: string, secret: string) => `https://d/${id}?c=${secret}`,
    report: (event: string) => log.push(`report ${event}`),
  } as unknown as Deps;
  return { deps, log };
};

describe('createBroadcastSweep', () => {
  test('a failed Youth cleanup is reported and the pass goes on', async () => {
    const { deps, log } = world({
      endYouthBroadcasts: async () => {
        throw new Error('down');
      },
      discoverUnopened: async () => [
        { roundId: 'r1', competitionType: 'ranked', capture: null },
      ],
    });
    await createBroadcastSweep(deps)();
    assert({
      given: 'the Youth cleanup failing',
      should: 'report it and still open the ranked Round’s Broadcast',
      actual: log,
      expected: [
        'report broadcast.reconcile_failed',
        'open r1 random-key {"kind":"delay","seconds":60}',
      ],
    });
  });

  test('a Youth Round opens no Broadcast, and one opened earlier is stopped (ADR 0150)', async () => {
    const { deps, log } = world({
      endYouthBroadcasts: async () => ['b-youth'],
      discoverUnopened: async () => [
        {
          roundId: 'youth',
          competitionType: 'ranked',
          capture: null,
          ladderDivision: 'youth',
        },
      ],
    });
    await createBroadcastSweep(deps)();
    assert({
      given: 'an open Youth Broadcast and a running Youth Round with none',
      should: 'report the stop and open nothing',
      actual: log,
      expected: ['report broadcast.youth_round_stopped'],
    });
  });

  test('opens a Broadcast for a ranked Round at the fixed ranked policy', async () => {
    const { deps, log } = world({
      discoverUnopened: async () => [
        { roundId: 'r9', competitionType: 'ranked', capture: null },
      ],
    });
    await createBroadcastSweep(deps)();
    assert({
      given: 'a ranked Round with no Broadcast',
      should: 'open one at the ranked policy',
      actual: log,
      expected: ['open r9 random-key {"kind":"delay","seconds":60}'],
    });
  });
  test('opens a casual Round at its host’s release, and nothing without a choice', async () => {
    const { deps, log } = world({
      discoverUnopened: async () => [
        {
          roundId: 'chosen',
          competitionType: 'casual',
          capture: {
            broadcast: {
              release: { kind: 'delay', seconds: 300 },
              debatersReadChat: true,
            },
            recordingPolicy: 'off',
          },
        },
        {
          roundId: 'recorded',
          competitionType: 'casual',
          capture: { broadcast: null, recordingPolicy: 'released' },
        },
      ],
    });
    await createBroadcastSweep(deps)();
    assert({
      given: 'a casual Broadcast choice and a recording alone',
      should: 'open only the first, at the host’s release',
      actual: log,
      expected: ['open chosen random-key {"kind":"delay","seconds":300}'],
    });
  });
  test('one failing Broadcast does not stop the others', async () => {
    const reads: string[] = [];
    const { deps, log } = world({
      listOpen: async () => [
        open({ id: 'bad', roundId: 'bad' }),
        open({ id: 'good', roundId: 'good' }),
      ],
      readRound: async (roundId: string) => {
        reads.push(roundId);
        if (roundId === 'bad') throw new Error('read failed');
        return null;
      },
    });
    await createBroadcastSweep(deps)();
    assert({
      given: 'a read failing on the first of two Broadcasts',
      should: 'report it and still reach the second',
      actual: [reads, log],
      expected: [['bad', 'good'], ['report broadcast.reconcile_failed']],
    });
  });
  test('a Broadcast past the release bound alerts once', async () => {
    const lagging = open({
      egressStartedAt: new Date(0),
      releasedThroughAt: new Date(800_000),
    });
    const { deps, log } = world({ listOpen: async () => [lagging] });
    const sweep = createBroadcastSweep(deps);
    await sweep();
    await sweep();
    assert({
      given: 'two passes over a Broadcast 200 s behind a 60 s delay',
      should: 'report the crossing once',
      actual: log,
      expected: ['report broadcast.release_delayed'],
    });
  });
  test('an instance that loses the claim leaves the Broadcast alone', async () => {
    const reads: string[] = [];
    const { deps } = world({
      listOpen: async () => [open()],
      claimReconcile: async () => false,
      readRound: async (roundId: string) => {
        reads.push(roundId);
        return null;
      },
    });
    await createBroadcastSweep(deps)();
    assert({
      given: 'another instance holding the reconcile claim',
      should: 'not read or act on it, so a second Egress cannot start',
      actual: reads,
      expected: [],
    });
  });
});

test('a logically completed Broadcast retains pending recovery and stops unknown physical work even if observer revocation fails', async () => {
  const traces = [];
  for (const pending of [true, false]) {
    const { deps, log } = world({
      listOpen: async () => [
        open({
          completedAt: new Date(1),
          egressId: pending ? null : 'EG',
          egressDispatchedAt: new Date(0),
          egressGeneration: 1,
          stageCredentialHash: 'HASH',
        }),
      ],
      readRound: async () => ({
        round: lockedRound.round,
        endedAt: null,
        roomName: 'media-room',
      }),
      recordRevocationFailed: async () => {
        log.push('failed-revocation');
      },
    });
    const sweep = createBroadcastSweep({
      ...deps,
      egress: {
        ...deps.egress,
        read: async () => ({ kind: 'unresolved', id: 'EG' }),
        readStageAttempt: async () => {
          log.push('recover');
          return { kind: 'unresolved' };
        },
        revokeObserver: async () => {
          throw new Error('Controlled revocation refusal');
        },
        stop: async (id) => {
          log.push(`stop ${id}`);
        },
      },
    });
    await sweep();
    await sweep.settled();
    traces.push(log);
  }
  assert({
    given:
      'completed feeds with a lost Start answer or unknown physical job, and unavailable revocation',
    should:
      'retain exact recovery or still request physical stop, never restart, settle, restore or reopen the feed',
    actual: traces,
    expected: [
      [
        'report broadcast.observer.revoke_retry_failed',
        'failed-revocation',
        'recover',
      ],
      [
        'report broadcast.observer.revoke_retry_failed',
        'failed-revocation',
        'stop EG',
      ],
    ],
  });
});

test('a pre-Tab Broadcast whose Egress LiveKit no longer knows settles, not fails, every pass', async () => {
  const settled: unknown[] = [];
  const { deps, log } = world({
    listOpen: async () => [
      open({
        completedAt: new Date(1),
        observerRevokedAt: new Date(1),
        egressId: 'EG_old',
        egressGeneration: 1,
      }),
    ],
    readRound: async () => ({
      round: lockedRound.round,
      endedAt: null,
      roomName: 'media-room',
    }),
    recordObserverRevoked: async () => undefined,
    settleEgressAttempt: async (input: unknown) => {
      settled.push(input);
      return true;
    },
  });
  const sweep = createBroadcastSweep({
    ...deps,
    egress: {
      ...deps.egress,
      read: async (id) => ({ kind: 'failed', id, reason: 'not_found' }),
      revokeObserver: async () => undefined,
      stop: async (id) => {
        log.push(`stop ${id}`);
      },
    },
  });
  await sweep();
  await sweep.settled();
  assert({
    given:
      'a completed legacy Broadcast of an over Round whose Egress record LiveKit has dropped',
    should:
      'settle that exact attempt and say why, without a failure or a stop',
    actual: [settled, log],
    expected: [
      [
        {
          id: 'b1',
          generation: 1,
          egressId: 'EG_old',
          observation: { kind: 'failed', id: 'EG_old', reason: 'not_found' },
        },
      ],
      ['report broadcast.egress.settled_absent'],
    ],
  });
});
