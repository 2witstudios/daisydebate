import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { BroadcastFacts } from '@daisy/debate-engine';
import { reconcileStep, type ReconcilePorts } from './reconcile-step';

setupRitewayBun();

const facts = (over: Partial<BroadcastFacts> = {}): BroadcastFacts => ({
  nowMs: 100_000,
  roundStatus: 'active',
  roundEndedAtMs: null,
  stoppedAtMs: null,
  completedAtMs: null,
  egress: { kind: 'none' },
  phase: { kind: 'public' },
  observerSubscribed: true,
  revocationFailures: 0,
  finalMediaEndMs: null,
  streamEndedMs: null,
  policy: { kind: 'delay', seconds: 60 },
  ...over,
});

const world = (over: Partial<ReconcilePorts> = {}) => {
  const log: string[] = [];
  const ports: ReconcilePorts = {
    holdClaim: async () => {
      log.push('hold');
    },
    releaseClaim: async () => {
      log.push('release');
    },
    startEgress: async () => {
      log.push('start');
      return 'EG_new';
    },
    recordEgressStarted: async (id) => {
      log.push(`recordStart ${id}`);
      return true;
    },
    stopEgress: async (id) => {
      log.push(`stop ${id}`);
    },
    revokeObserver: async () => {
      log.push('revoke');
    },
    recordRevoked: async () => {
      log.push('recordRevoked');
    },
    recordRevocationFailed: async () => {
      log.push('recordRevocationFailed');
    },
    restoreObserver: async () => {
      log.push('restore');
    },
    recordRestored: async () => {
      log.push('recordRestored');
    },
    recordFinalMediaEnd: async () => {
      log.push('recordFinalMediaEnd');
    },
    complete: async () => {
      log.push('complete');
    },
    report: (event) => {
      log.push(`report ${event}`);
    },
    ...over,
  };
  return { ports, log };
};

describe('reconcileStep', () => {
  test('a start that lost its generation stops what it started', async () => {
    const { ports, log } = world({ recordEgressStarted: async () => false });
    await reconcileStep(facts({ egress: { kind: 'none' } }), ports);
    assert({
      given: 'another instance having recorded this generation first',
      should: 'report it and stop the Egress it just started',
      actual: log,
      expected: [
        'hold',
        'start',
        'report broadcast.egress.start_lost',
        'stop EG_new',
        'release',
      ],
    });
  });
  test('starting an Egress records its id durably', async () => {
    const { ports, log } = world();
    await reconcileStep(facts(), ports);
    assert({
      given: 'a live Round with no Egress',
      should: 'start one and record it',
      actual: log,
      expected: ['hold', 'start', 'recordStart EG_new', 'release'],
    });
  });
  test('a failed revocation is recorded, so the next pass stops the Egress', async () => {
    const { ports, log } = world({
      revokeObserver: async () => {
        throw new Error('livekit unreachable');
      },
    });
    await reconcileStep(
      facts({
        egress: { kind: 'active', id: 'EG' },
        phase: { kind: 'private-at', atMs: 100_000 },
      }),
      ports,
    );
    assert({
      given: 'a revocation that throws',
      should: 'count the failure and never claim it was revoked',
      actual: log,
      expected: ['recordRevocationFailed'],
    });
  });
  test('a confirmed revocation is recorded', async () => {
    const { ports, log } = world();
    await reconcileStep(
      facts({
        egress: { kind: 'active', id: 'EG' },
        phase: { kind: 'private-at', atMs: 100_000 },
      }),
      ports,
    );
    assert({
      given: 'a revocation that succeeds',
      should: 'record it after the call',
      actual: log,
      expected: ['revoke', 'recordRevoked'],
    });
  });
  test('a repeated revocation records nothing new', async () => {
    const { ports, log } = world();
    await reconcileStep(
      facts({
        egress: { kind: 'active', id: 'EG' },
        phase: { kind: 'private' },
        observerSubscribed: false,
      }),
      ports,
    );
    assert({
      given: 'a private phase with the observer already revoked',
      should: 'revoke again and leave the record as it was',
      actual: log,
      expected: ['revoke'],
    });
  });

  test('stopping for an unconfirmed revocation reports it', async () => {
    const { ports, log } = world();
    await reconcileStep(
      facts({
        egress: { kind: 'active', id: 'EG' },
        phase: { kind: 'private' },
        revocationFailures: 1,
      }),
      ports,
    );
    assert({
      given: 'a private phase after a failed revocation',
      should: 'stop the Egress and report why',
      actual: log,
      expected: ['stop EG', 'report broadcast.egress.stopped_unconfirmed'],
    });
  });
  test('stopping for Round end records the final media end', async () => {
    const { ports, log } = world();
    await reconcileStep(
      facts({
        roundStatus: 'completed',
        roundEndedAtMs: 90_000,
        egress: { kind: 'active', id: 'EG' },
      }),
      ports,
    );
    assert({
      given: 'a terminal Round with a running Egress',
      should: 'stop it and record final media end at the stop',
      actual: log,
      expected: ['stop EG', 'recordFinalMediaEnd'],
    });
  });
  test('a stopped Broadcast with its Egress gone records that media ended', async () => {
    const { ports, log } = world();
    await reconcileStep(facts({ stoppedAtMs: 90_000 }), ports);
    assert({
      given: 'a stop and no running Egress',
      should: 'record the end, so the worker can complete it',
      actual: log,
      expected: ['recordFinalMediaEnd'],
    });
  });
  test('a failure in one action never escapes to the caller', async () => {
    const { ports, log } = world({
      startEgress: async () => {
        throw new Error('no capacity');
      },
    });
    const outcome = await reconcileStep(facts(), ports).then(
      () => 'resolved',
      () => 'rejected',
    );
    assert({
      given: 'Egress refusing a start',
      should:
        'report and resolve, so the audience sees a slate and the next pass retries',
      actual: [outcome, log],
      expected: [
        'resolved',
        ['hold', 'report broadcast.egress.start_failed', 'release'],
      ],
    });
  });
});
