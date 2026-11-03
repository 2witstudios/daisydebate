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
    discoverUnopenedRanked: async () => [] as { roundId: string }[],
    open: async (input: { roundId: string; releasePolicy: unknown }) => {
      log.push(`open ${input.roundId} ${JSON.stringify(input.releasePolicy)}`);
    },
    listOpen: async () => [] as unknown[],
    readRound: async () => null as unknown,
    recordEgressStarted: async (input: {
      egressId: string;
      stageCredentialHash: string;
    }) => {
      log.push(`recorded ${input.egressId} ${input.stageCredentialHash}`);
    },
    ...over,
  };
  const deps = {
    store,
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
      discoverUnopenedRanked: async () => [{ roundId: 'r9' }],
    });
    await createBroadcastSweep(deps)();
    assert({
      given: 'a ranked Round with no Broadcast',
      should: 'open one at the ranked policy',
      actual: log,
      expected: ['open r9 {"kind":"delay","seconds":60}'],
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
});
