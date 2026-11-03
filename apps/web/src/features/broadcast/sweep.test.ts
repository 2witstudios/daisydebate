import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createBroadcastSweep } from './sweep';

setupRitewayBun();

type Deps = Parameters<typeof createBroadcastSweep>[0];
const open = (over = {}) => ({
  id: 'b1',
  roundId: 'r1',
  egressId: null,
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
              release: { kind: 'round_end' },
              debatersReadChat: true,
            },
            recording: false,
          },
        },
        {
          roundId: 'recorded',
          competitionType: 'casual',
          capture: { broadcast: null, recording: true },
        },
      ],
    });
    await createBroadcastSweep(deps)();
    assert({
      given: 'a casual Broadcast choice and a recording alone',
      should: 'open only the first, at the host’s release',
      actual: log,
      expected: ['open chosen random-key {"kind":"round_end"}'],
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
